const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const monitorEl = document.getElementById("monitor");
const statusEl = document.getElementById("status");

function setUI(recording) {
  startBtn.disabled = recording;
  stopBtn.disabled = !recording;
  monitorEl.disabled = recording;
  statusEl.innerHTML = recording
    ? '<span class="rec">● 録音中…</span>'
    : "待機中";
}

async function refresh() {
  const res = await chrome.runtime.sendMessage({ type: "popup-status" });
  setUI(!!(res && res.recording));
}

startBtn.addEventListener("click", async () => {
  statusEl.textContent = "開始しています…";
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab) throw new Error("アクティブなタブが見つかりません");
    if (tab.url && /^(chrome|edge|about|chrome-extension):/.test(tab.url)) {
      throw new Error("このページ（chrome:// など）はキャプチャできません");
    }

    // 前回のキャプチャが残っていると "active stream" エラーになるので、先に解放する
    await chrome.runtime.sendMessage({ type: "popup-cleanup" });

    // クリック直後（ユーザー操作コンテキスト）で取得することでキャプチャを確実に有効化する
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tab.id,
    });

    const res = await chrome.runtime.sendMessage({
      type: "popup-start",
      streamId,
      monitor: monitorEl.checked,
      bitrate: 320,
    });
    if (res && res.ok) {
      setUI(true);
    } else {
      statusEl.textContent = "エラー: " + (res ? res.error : "不明");
    }
  } catch (e) {
    statusEl.textContent = "エラー: " + e.message;
  }
});

stopBtn.addEventListener("click", async () => {
  statusEl.textContent = "保存・変換しています…";
  await chrome.runtime.sendMessage({ type: "popup-stop" });
  setUI(false);
});

// offscreen からの録音結果（診断つき）を表示
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "rec-result") return;
  const silent = msg.peak < 0.001;
  statusEl.innerHTML =
    `保存しました<br>長さ ${msg.duration.toFixed(1)}s / ` +
    `ピーク ${msg.peak.toFixed(4)}` +
    (msg.trackMuted ? " / track=muted" : "") +
    (silent
      ? '<br><span style="color:#d33">⚠ 無音でした</span>'
      : "");
});

refresh();
