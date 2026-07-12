// Offscreen: タブ音声をキャプチャして録音・保存する。
//
// 長時間対応のポイント:
//   MP3 は「録音しながら逐次エンコード」する（最後に一括 decodeAudioData すると
//   長時間でメモリ破綻し数秒に切れるため）。ScriptProcessor で PCM を受け取り
//   lamejs に流し続け、停止時に flush して結合するだけ。何時間でも末尾まで入る。
//   WebM は MediaRecorder をそのまま使う（変換なしで高速）。
//
// 無音対策: audio+video で取得（audio 単独だと無音トラックになる）。

let recording = false;
let format = "mp3";
let autoStopTimer = null;

let captureStream = null;
let audioContext = null;
let source = null;

// MP3（逐次エンコード）
let processor = null;
let mp3encoder = null;
let mp3data = [];

// WebM（MediaRecorder）
let recorder = null;
let chunks = [];

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
    source = audioContext.createMediaStreamSource(audioStream);
    const sampleRate = audioContext.sampleRate;

    if (format === "mp3") {
      mp3encoder = new lamejs.Mp3Encoder(2, sampleRate, kbps || 320);
      mp3data = [];
      processor = audioContext.createScriptProcessor(4096, 2, 2);
      processor.onaudioprocess = (e) => {
        if (!recording) return;
        const ib = e.inputBuffer;
        const l = ib.getChannelData(0);
        const r = ib.numberOfChannels > 1 ? ib.getChannelData(1) : l;
        const buf = mp3encoder.encodeBuffer(floatTo16(l), floatTo16(r));
        if (buf.length > 0) mp3data.push(new Uint8Array(buf));
        // monitor: 入力をそのまま出力すると聞こえる。false なら出力は無音のまま。
        if (monitor) {
          e.outputBuffer.getChannelData(0).set(l);
          if (e.outputBuffer.numberOfChannels > 1) {
            e.outputBuffer.getChannelData(1).set(r);
          }
        }
      };
      source.connect(processor);
      processor.connect(audioContext.destination); // onaudioprocess を発火させるため
    } else {
      const recDest = audioContext.createMediaStreamDestination();
      source.connect(recDest);
      const gain = audioContext.createGain();
      gain.gain.value = monitor ? 1 : 0;
      source.connect(gain);
      gain.connect(audioContext.destination);
      chunks = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      recorder = new MediaRecorder(recDest.stream, { mimeType });
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onstop = finalizeWebm;
      recorder.start(1000);
    }

    // タブを閉じる等でキャプチャが切れたら自動保存
    captureStream.getTracks().forEach((t) => {
      t.onended = () => stop();
    });

    recording = true;
    chrome.runtime.sendMessage({ type: "started" });

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
    cleanup();
  }
}

function stop() {
  if (autoStopTimer) {
    clearTimeout(autoStopTimer);
    autoStopTimer = null;
  }
  if (!recording) return;
  recording = false;
  if (format === "mp3") {
    finalizeMp3();
  } else if (recorder && recorder.state !== "inactive") {
    recorder.stop(); // → finalizeWebm
  }
}

function finalizeMp3() {
  try {
    if (mp3encoder) {
      const end = mp3encoder.flush();
      if (end.length > 0) mp3data.push(new Uint8Array(end));
    }
    if (!mp3data.length) throw new Error("録音データが空でした");
    saveBlob(new Blob(mp3data, { type: "audio/mpeg" }), "mp3");
    chrome.runtime.sendMessage({ type: "saved" });
  } catch (e) {
    console.error("[TabAudioRecorder] MP3保存エラー:", e);
    chrome.runtime.sendMessage({ type: "rec-error", error: String(e.message || e) });
  } finally {
    mp3encoder = null;
    mp3data = [];
    cleanup();
  }
}

function finalizeWebm() {
  try {
    const blob = new Blob(chunks, { type: "audio/webm" });
    if (blob.size === 0) throw new Error("録音データが空でした");
    saveBlob(blob, "webm");
    chrome.runtime.sendMessage({ type: "saved" });
  } catch (e) {
    console.error("[TabAudioRecorder] WebM保存エラー:", e);
    chrome.runtime.sendMessage({ type: "rec-error", error: String(e.message || e) });
  } finally {
    chunks = [];
    recorder = null;
    cleanup();
  }
}

function saveBlob(blob, ext) {
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  chrome.runtime.sendMessage({
    type: "download",
    url,
    filename: `tab-audio-${stamp}.${ext}`,
  });
}

function cleanup() {
  if (processor) {
    processor.disconnect();
    processor.onaudioprocess = null;
    processor = null;
  }
  if (source) {
    source.disconnect();
    source = null;
  }
  if (captureStream) {
    captureStream.getTracks().forEach((t) => t.stop());
    captureStream = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
}

function floatTo16(input) {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
