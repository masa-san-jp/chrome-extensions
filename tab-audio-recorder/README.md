# Tab Audio Recorder

再生中のタブの音声を録音して **MP3** で保存する Chrome 拡張（Manifest V3・最小構成）です。

## 使い方

1. 音声・動画を再生しているタブを開く
2. **拡張アイコンをクリック** → 録音開始（アイコンに `REC` バッジが付く）
3. もう一度 **アイコンをクリック** → 停止して MP3 保存（保存ダイアログが開く）

録音中はタブの音がそのまま聞こえます。タブを閉じるなどでキャプチャが切れた場合は自動で停止・保存します。
うまくいかないときは、拡張アイコンにマウスを載せるとツールチップに状態やエラーが表示されます。

## インストール（開発版として読み込み）

1. Chrome で `chrome://extensions` を開く
2. 右上「デベロッパーモード」を **ON**
3. 「パッケージ化されていない拡張機能を読み込む」→ この `tab-audio-recorder` フォルダを選択

## 仕組み

- 拡張アイコンのクリック（`chrome.action.onClicked`）で `chrome.tabCapture.getMediaStreamId` を取得
- `offscreen` ドキュメントで `getUserMedia`(chromeMediaSource: tab) → `MediaRecorder` で録音
- 停止時に `decodeAudioData` → `lamejs`（同梱 `lame.min.js`）で MP3 に変換して保存
- audio だけだと Chrome が無音トラックを返すため audio+video で取得し、音声のみ録音

## 補足

- 出力は MP3 320kbps。
- `chrome://` などの内部ページはキャプチャできません。
- 「ミュートのまま録音」「N分後に自動停止」などは、この最小版が安定して動くことを確認してから追加予定です。
