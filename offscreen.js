// Offscreen ドキュメント: タブをキャプチャして音声を録音し、停止後に MP3 化する。
//
// 要件「ミュートでも音を抜く」を満たす設計:
//   source(タブ音声)
//     ├─ recDest(MediaStreamDestination) ← 常にフル音量。ここを MediaRecorder で録る
//     └─ gain(聞く=1 / ミュート=0) → destination(スピーカー)
//   → ミュート時は gain=0 でユーザーには無音だが、recDest はフル音量なので録音には音が入る。
//
// 無音を踏まないための2つの鉄則:
//   (1) audio だけ(video:false)で取ると Chrome は無音トラックを返す → audio+video で取得する。
//   (2) MediaRecorder は「生トラック」ではなく Web Audio の出力(recDest.stream)を録る
//       → 生トラックを Web Audio に繋ぐと MediaRecorder 側が無音になる競合を避けられる。
//
// MP3 変換のためのデコードは録音停止後に別 AudioContext で行う。

let recorder = null;
let chunks = [];
let captureStream = null;
let audioContext = null;
let bitrate = 320;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== "offscreen") return;
  if (msg.type === "start-recording") {
    startRecording(msg.streamId, msg.monitor, msg.bitrate).catch((e) =>
      console.error("[TabAudioRecorder] 録音開始エラー:", e)
    );
  } else if (msg.type === "stop-recording") {
    stopRecording();
  }
});

async function startRecording(streamId, monitor, kbps) {
  if (recorder && recorder.state === "recording") return;
  bitrate = kbps || 320;

  // (1) audio+video の両方を要求（audio 単独だと無音トラックになる）
  captureStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
    },
    video: {
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
    },
  });

  const audioStream = new MediaStream(captureStream.getAudioTracks());

  audioContext = new AudioContext();
  await audioContext.resume();
  const source = audioContext.createMediaStreamSource(audioStream);

  // 録音経路（常にフル音量・独立したシンク）
  const recDest = audioContext.createMediaStreamDestination();
  source.connect(recDest);

  // モニター経路（聞くかどうかを gain で切替。0 でも destination へ繋ぎ、音声を確実にレンダリングさせる）
  const gain = audioContext.createGain();
  gain.gain.value = monitor ? 1 : 0;
  source.connect(gain);
  gain.connect(audioContext.destination);

  // (2) 生トラックではなく Web Audio の出力を録る
  chunks = [];
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  recorder = new MediaRecorder(recDest.stream, { mimeType });
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.onstop = onStop;
  recorder.start();
}

function stopRecording() {
  if (recorder && recorder.state !== "inactive") recorder.stop();
}

async function onStop() {
  try {
    const webmBlob = new Blob(chunks, { type: "audio/webm" });
    const { blob, peak, duration } = await webmToMp3(webmBlob, bitrate);
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    chrome.runtime.sendMessage({
      target: "background",
      type: "download",
      url,
      filename: `tab-audio-${stamp}.mp3`,
    });
    chrome.runtime.sendMessage({ type: "rec-result", peak, duration });
  } catch (e) {
    console.error("[TabAudioRecorder] MP3 変換エラー:", e);
  } finally {
    if (captureStream) {
      captureStream.getTracks().forEach((t) => t.stop());
      captureStream = null;
    }
    if (audioContext) {
      await audioContext.close();
      audioContext = null;
    }
    recorder = null;
    chunks = [];
  }
}

async function webmToMp3(webmBlob, kbps) {
  const arrayBuffer = await webmBlob.arrayBuffer();
  const decodeCtx = new AudioContext();
  const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
  await decodeCtx.close();

  const channels = Math.min(audioBuffer.numberOfChannels, 2);
  const sampleRate = audioBuffer.sampleRate;
  const leftF = audioBuffer.getChannelData(0);

  let peak = 0;
  for (let i = 0; i < leftF.length; i++) {
    const a = Math.abs(leftF[i]);
    if (a > peak) peak = a;
  }

  const left = floatTo16(leftF);
  const right =
    channels === 2 ? floatTo16(audioBuffer.getChannelData(1)) : null;

  const encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps);
  const blockSize = 1152;
  const data = [];
  for (let i = 0; i < left.length; i += blockSize) {
    const lChunk = left.subarray(i, i + blockSize);
    let mp3buf;
    if (channels === 2) {
      const rChunk = right.subarray(i, i + blockSize);
      mp3buf = encoder.encodeBuffer(lChunk, rChunk);
    } else {
      mp3buf = encoder.encodeBuffer(lChunk);
    }
    if (mp3buf.length > 0) data.push(new Uint8Array(mp3buf));
  }
  const end = encoder.flush();
  if (end.length > 0) data.push(new Uint8Array(end));

  return {
    blob: new Blob(data, { type: "audio/mpeg" }),
    peak,
    duration: audioBuffer.duration,
  };
}

function floatTo16(input) {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
