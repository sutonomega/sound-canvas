# Sound Canvas

MP3・WAVから、音楽に反応する光の軌跡と抽象アートを作るブラウザアプリです。音源は端末内で処理します。

[公開アプリ](https://sutonomega.github.io/sound-canvas/)はmainから配信します。**2026-11-13時点の公開版は0.1、ここにあるdevの説明はv1.0公開候補向け**です。devへのマージだけでは公開されません。

## 使う・保存する

1. 「楽曲をドロップ / 選択」でMP3・WAVを選び、解析後に ▶ を押します。デモでも試せます。
2. 4スタイル、3テーマ、反応の強さ、軌跡、比率を選びます。初期比率は9:16です。
3. 現在／曲末のPNGを生成、または音声付き全曲MVを録画し、完了後の保存リンクを押します。

[利用ガイド](docs/user-guide.md)に操作、キーボード、保存、音源の扱い、不具合報告をまとめています。[録画ガイド](docs/recording-guide.md)も参照してください。録画は曲と同程度の時間が必要です。画面を表示したまま待ち、閉じる前に成果物を保存してください。自動保存はありません。

Windows / Chrome 157・Edge 157での確認範囲と未確認環境は[リリース確認記録](docs/release-checklist.md)を参照してください。WebM出力に対応し、MP4は未実装です。長時間・大容量音源はメモリや描画性能の制約があります。利用・公開する素材の権利と利用元の規約を確認してください。

## ローカル起動・開発

新しく取得する場合は`git clone --branch dev https://github.com/sutonomega/sound-canvas.git`でdevを選び、リポジトリのフォルダで実行します。

```sh
python -m http.server 8765 --bind 127.0.0.1 --directory dist
```

[http://127.0.0.1:8765/](http://127.0.0.1:8765/)を開きます。Python 3を使い、終了はCtrl+Cです。直接HTMLを開く方法では動作しません。ビルド・依存パッケージのインストールは不要です。Node.js 24で`npm test`を実行できます。

[開発・検証・公開ガイド](docs/development-and-release.md)に環境準備、変更、dev宛PR、mainへの公開、復旧をまとめています。mainへのpushで[公開ワークフロー](.github/workflows/pages.yml)が`dist/`をGitHub Pagesへ配信します。v1.0のCI・公開整備は[Issue #21](https://github.com/sutonomega/sound-canvas/issues/21)で進めます。

## 構成と計画

音楽解析、固定刻みの描画、独立したスタイル、制作制御、PNG・動画出力を分離しています。新スタイルは共通契約とレジストリで追加します。同じ曲・設定・時刻の再現を目指しますが、ブラウザ間の画素一致は保証しません。

- [仕様](docs/spec.md)・[設計と実装構成](docs/design.md)・[公開範囲](docs/service-scope.md)
- [ロードマップ](docs/roadmap.md)・[プロジェクト推進・レビュー対応](docs/project-workflow.md)
- [Issue一覧](https://github.com/sutonomega/sound-canvas/issues)・[マイルストーン](https://github.com/sutonomega/sound-canvas/milestones)
- [再現性](docs/issue-13-validation.md)・[同期と画質](docs/issue-16-validation.md)・[PNG保存](docs/issue-17-validation.md)・[操作性](docs/issue-19-validation.md)
