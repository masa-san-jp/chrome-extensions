// Service Worker: ポップアップからの指示で録音を開始/停止する。
// 録音の中身（getMediaStreamId → offscreen → 録音）は動作実績のある構成のまま。

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  return contexts.length > 0;
}

async function createOffscreen() {
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
    justification: "タブ音声をキャプチャして録音するため",
  });
}

async function closeOffscreen() {
  if (await hasOffscreen()) await chrome.offscreen.closeDocument();
}

async function isRecording() {
  if (!(await hasOffscreen())) return false;
  try {
    const res = await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "get-status",
    });
    return !!(res && res.recording);
  } catch (e) {
    return false;
  }
}

function setBadge(text) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: "#d33" });
}

async function startRecording() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("アクティブなタブが見つかりません");
  if (tab.url && /^(chrome|edge|about|chrome-extension):/.test(tab.url)) {
    throw new Error("このページ（chrome:// など）はキャプチャできません");
  }
  await closeOffscreen(); // 残っていれば解放
  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: tab.id,
  });
  const settings = await chrome.storage.local.get({
    monitor: true,
    minutes: 0,
    format: "mp3",
    bitrate: 320,
  });
  await createOffscreen();
  await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "start",
    streamId,
    monitor: settings.monitor,
    minutes: settings.minutes,
    format: settings.format,
    bitrate: settings.bitrate,
  });
  setBadge("REC");
}

async function stopRecording() {
  if (await hasOffscreen()) {
    await chrome.runtime.sendMessage({ target: "offscreen", type: "stop" });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "get-status") {
        sendResponse({ ok: true, recording: await isRecording() });
      } else if (msg.type === "start") {
        await startRecording();
        sendResponse({ ok: true });
      } else if (msg.type === "stop") {
        await stopRecording();
        sendResponse({ ok: true });
      } else if (msg.type === "download") {
        chrome.downloads.download({
          url: msg.url,
          filename: msg.filename,
          saveAs: true,
        });
        sendResponse({ ok: true });
      } else if (msg.type === "saved") {
        setBadge("");
        sendResponse({ ok: true });
      } else if (msg.type === "rec-error") {
        setBadge("");
        sendResponse({ ok: true });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
  })();
  return true;
});
