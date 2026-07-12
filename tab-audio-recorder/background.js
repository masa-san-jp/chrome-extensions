// Service Worker: アイコンクリックで録音の開始/停止をトグルする（Google公式の最小構成）。
// 状態の真実は「offscreen が録音中か」を offscreen に問い合わせて得る（storage 不要）。

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

// offscreen が録音中かを問い合わせる
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

function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (await isRecording()) {
      // 停止して保存
      await chrome.runtime.sendMessage({ target: "offscreen", type: "stop" });
      chrome.action.setTitle({ title: "保存中…" });
      return;
    }

    // 開始
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
    setBadge("REC", "#d33");
    chrome.action.setTitle({ title: "録音中… クリックで停止・保存" });
  } catch (e) {
    setBadge("ERR", "#d33");
    chrome.action.setTitle({ title: "エラー: " + (e.message || e) });
    console.error("[TabAudioRecorder]", e);
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "download") {
    chrome.downloads.download({
      url: msg.url,
      filename: msg.filename,
      saveAs: true,
    });
  } else if (msg.type === "saved") {
    setBadge("", "#d33");
    chrome.action.setTitle({ title: "保存しました / クリックで録音開始" });
  } else if (msg.type === "rec-error") {
    setBadge("ERR", "#d33");
    chrome.action.setTitle({ title: "エラー: " + msg.error });
  }
});
