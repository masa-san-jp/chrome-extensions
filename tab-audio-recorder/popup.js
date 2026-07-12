const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const monitorEl = document.getElementById("monitor");
const minutesEl = document.getElementById("minutes");
const statusEl = document.getElementById("status");

function setUI(recording) {
  startBtn.disabled = recording;
  stopBtn.disabled = !recording;
  monitorEl.disabled = recording;
  minutesEl.disabled = recording;
  if (recording) statusEl.innerHTML = '<span class="rec">● 録音中…</span>';
  else if (!statusEl.textContent) statusEl.textContent = "待機中";
}

async function refresh() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "popup-sync" });
    setUI(!!(res && res.recording));
  } catch (e) {
    setUI(false);
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.recording) setUI(!!changes.recording.newValue);
});

startBtn.addEventListener("click", async () => {
  statusEl.textContent = "開始しています…";
  const minutes = Math.max(0, parseFloat(minutesEl.value) || 0);
  try {
    const res = await chrome.runtime.sendMessage({
      type: "popup-start",
      monitor: monitorEl.checked,
      minutes,
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
