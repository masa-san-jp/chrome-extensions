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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== "offscreen") return;
  if (msg.type === "get-status") {
    sendResponse({ recording });
    return;
  }
  if (msg.type === "start") {
    start(msg.streamId);
  } else if (msg.type === "stop") {
    stop();
  }
});

async function start(streamId) {
  if (recording) return;
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
    source.connect(recDest); // 録音用（フル音量）
    source.connect(audioContext.destination); // スピーカーへ（聞こえる＆レンダリング維持）

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
  if (recorder && recorder.state !== "inactive") recorder.stop();
}

async function onStop() {
  recording = false;
  try {
    const webmBlob = new Blob(chunks, { type: "audio/webm" });
    if (webmBlob.size === 0) throw new Error("録音データが空でした");
    const blob = await webmToMp3(webmBlob, 320);
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    chrome.runtime.sendMessage({
      type: "download",
      url,
      filename: `tab-audio-${stamp}.mp3`,
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
