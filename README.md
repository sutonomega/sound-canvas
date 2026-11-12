# Sound Canvas 0.1

公開アプリ: https://sutonomega.github.io/sound-canvas/

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
3. テーマ・反応・軌跡・比率を変更できます。変更時やシーク時は冒頭から軌跡を再計算します。
4. 「現在のアートをPNGで保存」でその時点のキャンバスを保存します。曲末まで進めると完成アートを保存できます。

## ローカル実行

Python がある場合、このフォルダで `python -m http.server 8765 --directory dist` を実行して http://localhost:8765 を開きます。ファイルを直接開く方式では JavaScript モジュールが動作しません。

## 構成

- dist/audio.js: Web Audio による読み込み、再生、事前解析。30 Hz の音量・低中高域・簡易ビート。
- dist/analysis.js: チャンネル別の帯域解析、平滑化、簡易ビート・盛り上がり、固定シードと共通解析データ。
- dist/renderer.js: Canvas 2D の独立した描画エンジン。固定シード、固定時間刻み。
- dist/app.js: 操作、シークの復元、PNG保存。
- dist/controller.js: 読込候補の確定、処理の中止・世代管理、再生意図とシーク復元の制御。

## 開発時の確認

Node.js 24 で `npm test` を実行すると、音楽解析、読込・復元の競合、失敗/中止後の復帰、曲末からの再生などを確認できます。追加パッケージのインストールは不要です。

同じブラウザで同じ曲・設定・時刻なら同じ描画を目指しています。音声デコードやCanvasの実装差によりブラウザ間で画素の完全一致は保証しません。長い曲のシークは再計算に時間がかかります。音源全体をメモリに読み込むため、長時間の大容量WAVには向きません。

現段階は有機的な曲線のみです。動画・MP4・他の描画スタイル・プリセット保存は未実装です。追加ライブラリやビルドは不要です。
