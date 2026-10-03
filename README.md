# Chrome Extensions

自作の Chrome 拡張機能をまとめて公開しているリポジトリです。各拡張はサブフォルダに分かれています。

## 拡張一覧

| 拡張 | 説明 |
| --- | --- |
| [tab-audio-recorder](./tab-audio-recorder) | 再生中のタブの動画・音声を録音して MP3 で保存する拡張。ミュート状態でも録音可能。 |
| [selection-to-csv](./selection-to-csv) | スプレッドシートで選択・コピーした範囲を CSV で保存する拡張。Google スプレッドシート / Excel Online 等に対応。 |

## インストール（共通・開発版として読み込み）

1. Chrome で `chrome://extensions` を開く
2. 右上の「デベロッパーモード」を **ON**
3. 「パッケージ化されていない拡張機能を読み込む」→ 使いたい拡張の**サブフォルダ**（例: `tab-audio-recorder`）を選択

各拡張の詳しい使い方は、それぞれのフォルダ内の README を参照してください。

## ライセンス

[MIT License](./LICENSE)（各拡張が同梱する第三者ライブラリのライセンスは各 README / LICENSE 内の記載に従います）


## 用語としての用例と設計意図

「タブの音声を録音して保存する」「表でコピーした範囲だけをCSVにする」といった、ブラウザ上の小さな反復作業を独立した拡張で扱います。リポジトリ全体を1つの拡張として読み込むものではありません。

## 技術的背景

両拡張とも Manifest V3 です。selection-to-csv はページのDOMを解析せず、コピーされたTSVをクリップボードから読みます。tab-audio-recorder は tabCapture と offscreen を利用し、音声をファイルとして保存します。必要な権限は各 manifest と README を確認してください。

## 歴史的背景と展開

[2026年7月12日の更新](https://github.com/masa-san-jp/chrome-extensions/commit/18d45fc5d6da27ead62a808d32ff98a210655e80) では、録音中にMP3を逐次エンコードする方式へ変更しました。録音の詳細な現行処理は [offscreen.js](tab-audio-recorder/offscreen.js) が参照先です。利用・変更は拡張ごとに行い、録音対象の権利や同意、クリップボードに含む情報を確認してください。開発版としての配布手順を示しており、ストア公開や任意環境での動作保証を示すものではありません。
