# Tab Audio Recorder

Chrome の再生中タブ（YouTube・動画・音楽など）の**音声だけ**を録音し、**MP3 ファイル**として保存する拡張機能です。**ミュート（無音）状態でも音声を抜き出せます。**

## インストール（開発版として読み込み）

1. Chrome で `chrome://extensions` を開く
2. 右上の「デベロッパーモード」を **ON**
3. 「パッケージ化されていない拡張機能を読み込む」→ このフォルダ（`tab-audio-recorder`）を選択
4. ツールバーに拡張アイコンが出れば完了

## 使い方

1. 録音したいタブ（動画・音声を再生するページ）を開く
2. 拡張アイコンをクリック
3. 必要に応じて「録音中もタブの音を再生する」を切り替え
   - **ON**: いつも通り音を聞きながら録音
   - **OFF**: タブは無音のまま録音（＝ミュート録音）
4. 「● 録音開始」→ 再生 → 「■ 停止して保存」で保存ダイアログが出ます

## 「ミュートでも録音できる」仕組み

`chrome.tabCapture` はタブの音声を横取りします。取り込んだ音を
スピーカーに返すかどうかで挙動が変わります。

- 音を返す → 普通に聞こえる
- 音を返さない → ユーザーには無音（ミュート）だが、録音データは取れる

チェックボックス OFF が後者に相当します。

## 技術構成

- **Manifest V3** / `tabCapture` + `offscreen` + `downloads`
- `background.js`: 録音の開始・停止の統括、`getMediaStreamId` の取得
- `offscreen.js`: `getUserMedia`(chromeMediaSource: tab) → `MediaRecorder` で録音し、停止時に `decodeAudioData` → `lamejs` で MP3 エンコード
- `lame.min.js`: MP3 エンコーダ（[lamejs](https://github.com/zhuker/lamejs) v1.2.1・同梱）
- `popup.*`: UI

## 補足

- 出力は **MP3 320 kbps**（`audio/mpeg`）固定です。
- MP3 化はブラウザ内（オフライン）で完結します。外部サーバーには一切送信しません。
- 録音は停止時にまとめてエンコードするため、長時間録音ではメモリを多く使います。
- `chrome://` などの内部ページはキャプチャできません。
- アイコン画像は未同梱です（Chrome の既定アイコンで動作します）。必要なら `manifest.json` に `icons` を追加してください。
