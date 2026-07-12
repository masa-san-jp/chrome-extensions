const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const monitorEl = document.getElementById("monitor");
const statusEl = document.getElementById("status");

function setUI(recording) {
  startBtn.disabled = recording;
  stopBtn.disabled = !recording;
  monitorEl.disabled = recording;
  if (recording) statusEl.innerHTML = '<span class="rec">● 録音中…</span>';
  else if (!statusEl.textContent) statusEl.textContent = "待機中";
}

// 実体(offscreen)と突き合わせた本当の状態を取得。残った recording=true はここでリセットされる。
async function refresh() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "popup-sync" });
    setUI(!!(res && res.recording));
  } catch (e) {
    setUI(false);
  }
}

// 録音状態が変わったら（自動保存や別ウィンドウ操作でも）UIを追従
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.recording) {
    setUI(!!changes.recording.newValue);
  }
});

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
      statusEl.textContent = "";
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
  stopBtn.disabled = true;
  await chrome.runtime.sendMessage({ type: "popup-stop" });
});

// offscreen からの結果表示
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "rec-result") {
    const silent = msg.peak < 0.001;
    statusEl.innerHTML =
      `保存しました<br>長さ ${msg.duration.toFixed(1)}s / ピーク ${msg.peak.toFixed(4)}` +
      (silent ? '<br><span class="err">⚠ 無音でした</span>' : "");
  } else if (msg.type === "rec-error") {
    statusEl.innerHTML = '<span class="err">保存できず: ' + msg.error + "</span>";
  }
});

refresh();
