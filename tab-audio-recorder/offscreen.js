// Offscreen: タブ音声をキャプチャして録音し、停止時に MP3 化して保存する（最小構成）。
//
// 要点（実績のある組み合わせ）:
//   - audio+video で取得（audio 単独だと Chrome が無音トラックを返すため）
//   - Web Audio の出力(recDest)を録音（生トラックを録ると Web Audio と競合して無音になる）
//   - タブの音はスピーカーへ返して聞こえるようにする（＝レンダリング維持で確実に音が入る）

let recorder = null;
let chunks = [];
let captureStream = null;
let audioContext = null;
let recording = false;
let autoStopTimer = null;
let format = "mp3";
let bitrate = 320;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== "offscreen") return;
  if (msg.type === "get-status") {
    sendResponse({ recording });
    return;
  }
  if (msg.type === "start") {
    start(msg.streamId, msg.monitor, msg.minutes, msg.format, msg.bitrate);
  } else if (msg.type === "stop") {
    stop();
  }
});

async function start(streamId, monitor, minutes, fmt, kbps) {
  if (recording) return;
  format = fmt === "webm" ? "webm" : "mp3";
  bitrate = kbps || 320;
  try {
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
    const source = audioContext.createMediaStreamSource(audioStream);
    const recDest = audioContext.createMediaStreamDestination();
    source.connect(recDest); // 録音用（常にフル音量）

    // モニター: monitor=true で聞こえる。false でも gain=0 で destination に繋ぎ、
    // ユーザーには無音のままレンダリングを維持して録音する（＝ミュート録音）。
    const gain = audioContext.createGain();
    gain.gain.value = monitor ? 1 : 0;
    source.connect(gain);
    gain.connect(audioContext.destination);

    chunks = [];
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    recorder = new MediaRecorder(recDest.stream, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = onStop;

    // タブを閉じる等でキャプチャが切れたら自動で停止＆保存
    captureStream.getTracks().forEach((t) => {
      t.onended = () => stop();
    });

    recorder.start(1000);
    recording = true;

    // N分後に自動停止（停止すれば onStop で保存される）
    if (minutes && minutes > 0) {
      autoStopTimer = setTimeout(() => {
        console.log(`[TabAudioRecorder] ${minutes}分経過 → 自動停止`);
        stop();
      }, minutes * 60 * 1000);
    }
  } catch (e) {
    console.error("[TabAudioRecorder] 開始エラー:", e);
    recording = false;
    chrome.runtime.sendMessage({
      type: "rec-error",
      error: "[getUserMedia] " + String(e.message || e),
    });
  }
}

function stop() {
  if (autoStopTimer) {
    clearTimeout(autoStopTimer);
    autoStopTimer = null;
  }
  if (recorder && recorder.state !== "inactive") recorder.stop();
}

async function onStop() {
  recording = false;
  try {
    const webmBlob = new Blob(chunks, { type: "audio/webm" });
    if (webmBlob.size === 0) throw new Error("録音データが空でした");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");

    let blob, ext;
    if (format === "webm") {
      blob = webmBlob; // 変換なし（そのまま保存）
      ext = "webm";
    } else {
      blob = await webmToMp3(webmBlob, bitrate);
      ext = "mp3";
    }
    const url = URL.createObjectURL(blob);
    chrome.runtime.sendMessage({
      type: "download",
      url,
      filename: `tab-audio-${stamp}.${ext}`,
    });
    chrome.runtime.sendMessage({ type: "saved" });
  } catch (e) {
    console.error("[TabAudioRecorder] 保存エラー:", e);
    chrome.runtime.sendMessage({
      type: "rec-error",
      error: String(e.message || e),
    });
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
  const left = floatTo16(audioBuffer.getChannelData(0));
  const right = channels === 2 ? floatTo16(audioBuffer.getChannelData(1)) : null;

  const encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps);
  const blockSize = 1152;
  const data = [];
  for (let i = 0; i < left.length; i += blockSize) {
    const lChunk = left.subarray(i, i + blockSize);
    let mp3buf;
    if (channels === 2) {
      mp3buf = encoder.encodeBuffer(lChunk, right.subarray(i, i + blockSize));
    } else {
      mp3buf = encoder.encodeBuffer(lChunk);
    }
    if (mp3buf.length > 0) data.push(new Uint8Array(mp3buf));
  }
  const end = encoder.flush();
  if (end.length > 0) data.push(new Uint8Array(end));
  return new Blob(data, { type: "audio/mpeg" });
}

function floatTo16(input) {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
