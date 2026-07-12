// Service Worker: 録音の開始/停止を統括し、offscreen ドキュメントへ指示を出す。
// getMediaStreamId は background で呼ぶ（この構成が実績あり）。状態は chrome.storage.local.recording。

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

async function closeOffscreen() {
  if (await hasOffscreen()) {
    await chrome.offscreen.closeDocument();
  }
  await chrome.storage.local.set({ recording: false });
}

async function startRecording(monitor, minutes) {
  let step = "init";
  try {
    // 前回のキャプチャが残っていると "active stream" になるので、先に解放
    step = "closeOffscreen";
    await closeOffscreen();

    step = "queryTab";
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error("アクティブなタブが見つかりません");
    if (tab.url && /^(chrome|edge|about|chrome-extension):/.test(tab.url)) {
      throw new Error("このページ（chrome:// など）はキャプチャできません");
    }

    step = "getMediaStreamId";
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tab.id,
    });

    step = "ensureOffscreen";
    await ensureOffscreen();

    step = "sendStart";
    await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "start-recording",
      streamId,
      monitor,
      minutes,
      bitrate: 320,
    });
  } catch (e) {
    throw new Error(`[${step}] ${e.message || e}`);
  }
}

async function stopRecording() {
  if (await hasOffscreen()) {
    await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "stop-recording",
    });
  } else {
    await chrome.storage.local.set({ recording: false });
  }
}

// offscreen が本当に生きているかで状態を突き合わせ、残った recording=true をリセット
async function syncState() {
  const offscreen = await hasOffscreen();
  const { recording } = await chrome.storage.local.get("recording");
  const real = offscreen && !!recording;
  if (!!recording !== real) await chrome.storage.local.set({ recording: real });
  return real;
}

function setBadge(rec) {
  chrome.action.setBadgeText({ text: rec ? "REC" : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#d33" });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.recording) setBadge(!!changes.recording.newValue);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "popup-sync") {
        sendResponse({ ok: true, recording: await syncState() });
      } else if (msg.type === "popup-start") {
        try {
          await startRecording(!!msg.monitor, msg.minutes || 0);
          await chrome.storage.local.remove("lastStatus");
          sendResponse({ ok: true });
        } catch (e) {
          await chrome.storage.local.set({
            lastStatus: { type: "error", text: e.message },
          });
          sendResponse({ ok: false, error: e.message });
        }
      } else if (msg.type === "popup-stop") {
        await stopRecording();
        sendResponse({ ok: true });
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
  return true;
});
