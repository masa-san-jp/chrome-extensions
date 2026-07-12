// Service Worker: 録音の開始/停止を統括し、offscreen ドキュメントへ指示を出す。

let recording = false;

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
    justification: "タブ音声をキャプチャして録音するため",
  });
}

// offscreen ドキュメントを閉じて、掴んだままのタブキャプチャストリームを解放する
async function closeOffscreen() {
  if (await hasOffscreen()) {
    await chrome.offscreen.closeDocument();
  }
  recording = false;
  updateBadge();
}

async function startRecording(streamId, monitor, bitrate) {
  if (!streamId) throw new Error("ストリーム ID がありません");
  await ensureOffscreen();
  await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "start-recording",
    streamId,
    monitor,
    bitrate,
  });

  recording = true;
  updateBadge();
}

async function stopRecording() {
  await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "stop-recording",
  });
  recording = false;
  updateBadge();
}

function updateBadge() {
  chrome.action.setBadgeText({ text: recording ? "REC" : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#d33" });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "popup-cleanup") {
        // 開始前に既存のキャプチャ/offscreen を解放（"active stream" エラー対策）
        await closeOffscreen();
        sendResponse({ ok: true });
      } else if (msg.type === "popup-start") {
        await startRecording(msg.streamId, !!msg.monitor, msg.bitrate || 320);
        sendResponse({ ok: true });
      } else if (msg.type === "popup-stop") {
        await stopRecording();
        sendResponse({ ok: true });
      } else if (msg.type === "popup-status") {
        sendResponse({ ok: true, recording });
      } else if (msg.target === "background" && msg.type === "download") {
        await chrome.downloads.download({
          url: msg.url,
          filename: msg.filename,
          saveAs: true,
        });
        sendResponse({ ok: true });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // 非同期レスポンスのため
});
