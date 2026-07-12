const DEFAULTS = { monitor: true, minutes: 0, format: "mp3", bitrate: 320 };

const toggle = document.getElementById("toggle");
const statusEl = document.getElementById("status");
const monitorEl = document.getElementById("monitor");
const minutesEl = document.getElementById("minutes");
const formatEl = document.getElementById("format");
const bitrateEl = document.getElementById("bitrate");
const bitrateRow = document.getElementById("bitrateRow");

let recording = false;

function renderButton() {
  toggle.disabled = false;
  toggle.textContent = recording ? "■ 停止して保存" : "● 録音開始";
  toggle.classList.toggle("recording", recording);
  // 録音中は設定を編集不可（次回録音から反映される値なので固定）
  [monitorEl, minutesEl, formatEl, bitrateEl].forEach((el) => (el.disabled = recording));
  if (recording && !statusEl.textContent) {
    statusEl.innerHTML = '<span class="rec">● 録音中…</span>';
  }
}

function updateBitrateVisibility() {
  bitrateRow.style.display = formatEl.value === "mp3" ? "" : "none";
}

async function loadSettings() {
  const s = await chrome.storage.local.get(DEFAULTS);
  monitorEl.checked = !!s.monitor;
  minutesEl.value = s.minutes;
  formatEl.value = s.format;
  bitrateEl.value = String(s.bitrate);
  updateBitrateVisibility();
}

async function saveSettings() {
  await chrome.storage.local.set({
    monitor: monitorEl.checked,
    minutes: Math.max(0, parseFloat(minutesEl.value) || 0),
    format: formatEl.value,
    bitrate: parseInt(bitrateEl.value, 10) || 320,
  });
  updateBitrateVisibility();
}

[monitorEl, minutesEl, formatEl, bitrateEl].forEach((el) =>
  el.addEventListener("change", saveSettings)
);

async function refresh() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "get-status" });
    recording = !!(res && res.recording);
  } catch (e) {
    recording = false;
  }
  renderButton();
}

toggle.addEventListener("click", async () => {
  toggle.disabled = true;
  if (recording) {
    statusEl.textContent = "保存・変換しています…";
    await chrome.runtime.sendMessage({ type: "stop" });
  } else {
    statusEl.textContent = "開始しています…";
    const res = await chrome.runtime.sendMessage({ type: "start" });
    if (!res || !res.ok) {
      statusEl.innerHTML = '<span class="err">エラー: ' + (res ? res.error : "不明") + "</span>";
      recording = false;
      renderButton();
    }
    // 成功時は offscreen からの "started" で確定表示される
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "started") {
    recording = true;
    statusEl.innerHTML = '<span class="rec">● 録音中…</span>';
    renderButton();
  } else if (msg.type === "saved") {
    recording = false;
    statusEl.textContent = "保存しました";
    renderButton();
  } else if (msg.type === "rec-error") {
    recording = false;
    statusEl.innerHTML = '<span class="err">保存できず: ' + msg.error + "</span>";
    renderButton();
  }
});

loadSettings();
refresh();
