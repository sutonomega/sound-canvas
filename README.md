# Sound Canvas 0.1

公開アプリ: https://sutonomega.github.io/sound-canvas/

以下は開発中のdev向けの説明です。公開版はmainから配信します。

## 開発計画と進め方

- [v1.0までのロードマップ](docs/roadmap.md)
- [プロジェクト推進・レビュー対応ガイド](docs/project-workflow.md)
- [公開範囲と完成条件](docs/service-scope.md)・[機能仕様](docs/spec.md)・[設計](docs/design.md)
- [Issue一覧](https://github.com/sutonomega/sound-canvas/issues)・[マイルストーン](https://github.com/sutonomega/sound-canvas/milestones)

日常開発は作業ブランチから `dev` 宛てのPRで確認します。公開時に `dev` から `main` へ反映します。

## GitHub Pages への自動公開

`main` ブランチへの push で `.github/workflows/pages.yml` が実行され、`dist/` を GitHub Pages に公開します。ビルド・パッケージのインストールは不要です。公開結果はリポジトリの Actions で確認できます。楽曲ファイルや認証情報は含めないでください。

MP3 / WAV をブラウザ内で解析し、音楽の進行に応じて光の軌跡を描く試作品です。楽曲はサーバーに送信しません。

## 使い方

1. 配信先のページを開き「楽曲をドロップ / 選択」でファイルを選びます。
2. 解析完了後に ▶ を押します。「デモを体験する」でも試せます。
3. スタイル・テーマ・反応・軌跡・比率を変更できます。変更時やシーク時は冒頭から軌跡を再計算します。
4. 「現在のアートをPNGで保存」でその時点のキャンバスを保存します。曲末まで進めると完成アートを保存できます。

## ローカル実行

Python がある場合、このフォルダで `python -m http.server 8765 --directory dist` を実行して http://localhost:8765 を開きます。ファイルを直接開く方式では JavaScript モジュールが動作しません。

## 構成

- dist/audio.js: Web Audio による読み込み、再生、事前解析。30 Hz の音量・低中高域・簡易ビート。
- dist/analysis.js: チャンネル別の帯域解析、平滑化、簡易ビート・盛り上がり、固定シードと共通解析データ。
- dist/renderer.js: 固定シード・固定時間刻みの3層合成と状態の保存/復元。
- dist/app.js: 画面操作とPNG保存の接続。
- dist/controller.js: 読込候補の確定、処理の中止・世代管理、再生意図とシーク復元の制御。
- dist/styles/: 共通インターフェースに従う独立した描画スタイル。
- dist/timing.js・themes.js: 共通の時間刻みとテーマ定義。

## 開発時の確認

Node.js 24 で `npm test` を実行すると、音楽解析、読込・復元の競合、失敗/中止後の復帰、曲末からの再生などを確認できます。追加パッケージのインストールは不要です。

実Canvasの画素比較・PNG確認は[描画基盤の確認手順](docs/issue-7-validation.md)を参照してください。新スタイルは `dist/styles/index.js` に定義を登録し、[設計書](docs/design.md)の共通契約に従って追加します。

有機的な曲線の音楽反応・長時間蓄積の[比較画像と確認手順](docs/issue-8-validation.md)も用意しています。

幾何学模様も設定欄で選択できます。[比較画像と確認手順](docs/issue-9-validation.md)を参照してください。両スタイルは同じ解析値・描画基盤を利用します。

同じブラウザで同じ曲・設定・時刻なら同じ描画を目指しています。音声デコードやCanvasの実装差によりブラウザ間で画素の完全一致は保証しません。長い曲のシークは再計算に時間がかかります。音源全体をメモリに読み込むため、長時間の大容量WAVには向きません。

現在のdevでは有機的な曲線と幾何学模様に対応しています。動画・MP4・粒子・水彩・プリセット保存は未実装です。追加ライブラリやビルドは不要です。
