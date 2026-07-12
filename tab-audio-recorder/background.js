// Service Worker: 録音の開始/停止を統括し、offscreen ドキュメントへ指示を出す。
// 録音状態の真実は chrome.storage.local.recording（offscreen が更新）に置く。
// Service Worker は随時終了するため、状態変数は信頼しない。

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
  await chrome.storage.local.set({ recording: false });
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
}

async function stopRecording() {
  if (await hasOffscreen()) {
    await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "stop-recording",
    });
  } else {
    // offscreen が無い＝録音は既に消えている。状態だけ戻す。
    await chrome.storage.local.set({ recording: false });
  }
}

function setBadge(rec) {
  chrome.action.setBadgeText({ text: rec ? "REC" : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#d33" });
}

// 録音状態の変化に応じてバッジを更新
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.recording) {
    setBadge(!!changes.recording.newValue);
  }
});

// 実体（offscreen）と保存状態を突き合わせて本当の録音状態を返す。
// offscreen が無ければ録音していないので、残っていた recording=true をリセットする。
async function syncState() {
  const offscreen = await hasOffscreen();
  const { recording } = await chrome.storage.local.get("recording");
  const real = offscreen && !!recording;
  if (!!recording !== real) {
    await chrome.storage.local.set({ recording: real });
  }
  return real;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "popup-sync") {
        sendResponse({ ok: true, recording: await syncState() });
      } else if (msg.type === "popup-cleanup") {
        // 開始前に既存のキャプチャ/offscreen を解放（"active stream" エラー対策）
        await closeOffscreen();
        sendResponse({ ok: true });
      } else if (msg.type === "popup-start") {
        await startRecording(msg.streamId, !!msg.monitor, msg.bitrate || 320);
        sendResponse({ ok: true });
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
  return true; // 非同期レスポンスのため
});
