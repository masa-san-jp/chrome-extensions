const DEFAULTS = { monitor: true, minutes: 0, format: "mp3", bitrate: 320 };

const monitorEl = document.getElementById("monitor");
const minutesEl = document.getElementById("minutes");
const formatEl = document.getElementById("format");
const bitrateEl = document.getElementById("bitrate");
const bitrateRow = document.getElementById("bitrateRow");
const savedEl = document.getElementById("saved");

function updateBitrateVisibility() {
  bitrateRow.style.display = formatEl.value === "mp3" ? "" : "none";
}

async function load() {
  const s = await chrome.storage.local.get(DEFAULTS);
  monitorEl.checked = !!s.monitor;
  minutesEl.value = s.minutes;
  formatEl.value = s.format;
  bitrateEl.value = String(s.bitrate);
  updateBitrateVisibility();
}

let savedTimer = null;
async function save() {
  const settings = {
    monitor: monitorEl.checked,
    minutes: Math.max(0, parseFloat(minutesEl.value) || 0),
    format: formatEl.value,
    bitrate: parseInt(bitrateEl.value, 10) || 320,
  };
  await chrome.storage.local.set(settings);
  updateBitrateVisibility();
  savedEl.textContent = "保存しました ✓";
  if (savedTimer) clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (savedEl.textContent = ""), 1500);
}

[monitorEl, minutesEl, formatEl, bitrateEl].forEach((el) =>
  el.addEventListener("change", save)
);

load();
