const saveBtn = document.getElementById("save");
const bomEl = document.getElementById("bom");
const statusEl = document.getElementById("status");

function setStatus(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = cls || "";
}

// 区切り文字（tab）で引用符・改行を考慮してパースし、2次元配列にする
function parseDelimited(text, delim) {
  const rows = [];
  let field = [];
  let row = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < n && text[i + 1] === '"') {
          field.push('"');
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field.push(c);
      i += 1;
      continue;
    } else {
      if (c === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }
      if (c === delim) {
        row.push(field.join(""));
        field = [];
        i += 1;
        continue;
      }
      if (c === "\r") {
        i += 1;
        continue;
      }
      if (c === "\n") {
        row.push(field.join(""));
        field = [];
        rows.push(row);
        row = [];
        i += 1;
        continue;
      }
      field.push(c);
      i += 1;
      continue;
    }
  }
  if (field.length || row.length) {
    row.push(field.join(""));
    rows.push(row);
  }
  // 末尾の空行を除去
  while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") {
    rows.pop();
  }
  return rows;
}

// 2次元配列を RFC4180 準拠の CSV 文字列にする
function toCsv(rows) {
  return rows
    .map((r) =>
      r
        .map((f) => {
          if (/[",\n\r]/.test(f)) {
            return '"' + f.replace(/"/g, '""') + '"';
          }
          return f;
        })
        .join(",")
    )
    .join("\r\n");
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

saveBtn.addEventListener("click", async () => {
  setStatus("クリップボードを読み込み中…");
  try {
    const text = await navigator.clipboard.readText();
    if (!text || !text.trim()) {
      setStatus("クリップボードが空です。範囲を選択して⌘+Cしてから押してください。", "err");
      return;
    }
    const rows = parseDelimited(text, "\t");
    if (!rows.length) {
      setStatus("表データが見つかりませんでした。", "err");
      return;
    }
    let csv = toCsv(rows);
    if (bomEl.checked) csv = "\uFEFF" + csv;

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    await chrome.downloads.download({
      url,
      filename: `selection-${timestamp()}.csv`,
      saveAs: true,
    });
    const cols = rows[0].length;
    setStatus(`保存しました（${rows.length}行 × ${cols}列）`, "ok");
  } catch (e) {
    setStatus("エラー: " + e.message, "err");
  }
});
