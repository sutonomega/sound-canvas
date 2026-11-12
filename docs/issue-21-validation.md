# Issue #21 CI・公開準備の確認記録

確認日: 2026-11-13。基準はPR #40を統合したdev（`aafd644`）。本変更はCIと公開準備で、mainの公開、正式タグ・Releaseの作成は含まない。

## ローカル確認

- Windows / Node.js v24.15.0で`npm run check`成功。dist・tests・scriptsのJavaScript 44ファイルを確認。
- `npm test`は231件成功、失敗・スキップ0。
- 構文不正の一時ファイルをscriptsへ追加し、列挙の追記なしでチェック対象に入り、終了コード1で失敗することを確認。確認後、一時ファイルを削除した。
- `git diff --check`成功。変更文書の相対リンクの参照先を確認。
- GitHub上でM1〜M3の全17件、M4の#18〜#20の3件が完了していることを確認。#21だけをM4の未完了として維持する。

## CIの構成と確認範囲

PRとdevへのpushは読み取り権限の共通チェックを実行。Pagesは同じチェックを再利用し、`needs: checks`で成功後に限ってデプロイする。デプロイの条件をmainに限定し、非mainの手動実行で公開しない。Pages・IDトークンの書き込み権限はデプロイジョブだけへ付与する。

GitHub Actionsでの実行結果はこのPRのChecksと以下の追記で管理する。自動テストを実ブラウザの代替にせず、本変更で既存の画面操作・実音源検証を再実行したとは扱わない。

PR #41の`pull_request`イベントによる[実行 #43313212097](https://github.com/sutonomega/sound-canvas/actions/runs/43313212097)が成功。Ubuntu上のNode.js 24で構文確認・自動テストが通り、ワークフローの受理と実行を確認した（CI実装コミット`9a29819`）。以後の文書追記コミットの状態はPRのChecksを参照する。

main pushでのPagesデプロイ、非mainの手動実行、チェック失敗時の実デプロイ抑止は、ワークフローの設定を照合した段階。実配信での確認は未実施で、[公開準備記録](v1.0-release.md)に残す。公開中の版を使った障害注入は行わない。

## 完了までの残作業

CI用PRのdev統合後、版表記と公開文書を整えてdev→mainの公開PRを作る。mainのCI・Pages成功、公開URLでの読み込み・操作・PNG／WebMの実保存と再生を確認し、確認済みSHAへv1.0.0タグとReleaseを作成する。その後に#21とM4の完了条件を判定する。

## v1.0.0の版表記・公開文書の準備

2026-11-13、PR #41のdev統合（`20d5481`）と[dev CI成功](https://github.com/sutonomega/sound-canvas/actions/runs/43313441259)を確認した。

- packageのversionを`1.0.0`、画面下部を`VERSION 1.0.0`へ更新。アプリの操作・描画・保存ロジックは変更しない。
- README・利用／開発ガイドをv1.0.0の説明へ更新。0.1は初回公開の履歴として残し、現在の公開状態はリリース記録へ集約。
- Windows / Node.js v24.15.0で構文44ファイル、自動テスト231件が成功。
- 相対リンク、HTTP配信されるHTMLの版、旧表記だけが変更されたこと、`git diff --check`を確認。
- 公開直前のmainは`1fe36c0d05860d5edcd5443cb2643fff2d2ea241`。公開用PRの復旧先として記録する。

この段階では版表記更新のdev宛PRと、dev→mainの公開用下書きPRを分ける。公開用PRは版表記のdev統合後、最新SHA・CI・差分を再確認してからレビュー可能へ変更する。公開後の操作・保存、正式タグとReleaseは未実施。公開前のフッター変更のみのため、既存の実音源・ブラウザ操作の全件再検証は行っていない。

## 公開後の完了確認

PR #42のdev統合とPR #43のmain統合を確認。main `379616b`の[共通CI・Pages](https://github.com/sutonomega/sound-canvas/actions/runs/43314211660)が成功し、公開URLで制作・実保存を確認した。[公開記録](v1.0-release.md)と[匿名測定値](assets/public-release-metrics.json)に結果・範囲を記録。v1.0.0タグが確認済みSHAを指し、正式Releaseが公開済みであることも確認した。#21とM4の完了条件を満たす。

公開PRの統合時に削除されたdevブランチは、公開mainと同じSHAで復元した。本追記は文書のみのdev宛PRとし、タグの参照先・アプリを変更しない。ブラウザ操作中のエラーはfaviconの404のみで、主要フローの失敗は確認していない。
