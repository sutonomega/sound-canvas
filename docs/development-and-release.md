# 開発・検証・公開の手順

対応Issue: [#20](https://github.com/sutonomega/sound-canvas/issues/20)。日常の判断基準は[プロジェクト推進ガイド](project-workflow.md)、完成条件は[公開範囲](service-scope.md)と[ロードマップ](roadmap.md)を参照します。2026-11-13時点では公開mainは0.1、devはv1.0公開候補です。

## 初めて起動する

Git、Python 3、Node.js 24を用意します。Node.jsは自動確認用、Pythonはローカル配信用です。追加パッケージのインストールやビルドは不要です。新しい作業フォルダで次を実行します。

```sh
git clone --branch dev https://github.com/sutonomega/sound-canvas.git
cd sound-canvas
python -m http.server 8765 --bind 127.0.0.1 --directory dist
```

[http://127.0.0.1:8765/](http://127.0.0.1:8765/)を開きます。Windowsで`python`が使えず`py`が利用できる場合は先頭を`py -3`に置き換えます。終了は配信中の端末でCtrl+Cです。ポートが使用中なら番号を変更し、URLも合わせます。HTMLを直接開く`file://`ではモジュールを正常に読み込めません。

別の端末を同じリポジトリで開いて確認します。

```sh
node --version
npm run check
npm test
```

デモ→曲選択→再生・停止→設定変更→シーク→PNG生成・保存→短いMV録画・保存を試します。[利用ガイド](user-guide.md)を参照してください。録画には対応ブラウザが必要です。

## 変更からdevへのPRまで

1. `git status --short`で未保存の変更を確認します。変更がある場合は内容を保全し、別の作業へ混ぜないようにします。
2. 作業ツリーが空の状態で、以下を実行します。ブランチ名の番号・内容は対象Issueへ置き換えます。

```sh
git switch dev
git pull --ff-only origin dev
git switch -c feat/issue-N-description
```

3. Issueの目的・完了条件を読み、必要な実装・文書・確認を行います。不具合は`fix/`、文書は`docs/`を使います。
4. `npm run check`で全JavaScriptの構文を確認し、`npm test`と対象操作のブラウザ確認を行います。文書のみならリンクと手順を確認します。
5. `git diff --check`と`git diff`で差分を読み、対象ファイルを指定して追加・コミットします。例は`git add docs/user-guide.md`です。音源や個人情報を含む作業資料を一括追加しないでください。
6. `git push -u origin 作業ブランチ名`で送り、GitHubで **base: dev** のPRを作ります。[PRテンプレート](../.github/PULL_REQUEST_TEMPLATE.md)に目的、Refs #番号、差分、実施した確認と未確認事項を書きます。
7. レビュー後にdevへマージされたことを確認し、Issueの完了条件を照合して閉じます。既定ブランチはmainなので、dev宛PRの`Closes`記載だけで閉じたと判断しません。

`.gitignore`でMP3・WAVなどを除外していますが、すべての録画・画像・曲名入り資料を保護するものではありません。実音源、音声入り成果物、認証情報、個人パスはコミットしません。公開している合成サンプルと、個人の確認資料を区別します。

マージ後のブランチ整理は、対象PRと`git merge-base --is-ancestor 対象ブランチ origin/dev`で統合済みか確認してから行います。main・dev・現在の作業・復旧用ブランチを削除しません。squash等で祖先確認できない場合は差分を調べ、強制削除で進めないでください。

## どこを変更するか

| 場所 | 主な責務 |
| --- | --- |
| `dist/index.html` / CSS / `app.js` | 画面、操作の接続 |
| `audio.js` / `analysis.js` | 音声の読み込み・再生、曲全体の解析とシード |
| `controller.js` / `checkpoints.js` | 読み込み・復元の中止と競合制御、状態の再利用 |
| `renderer.js` / `timing.js` | 固定時間刻み、3層描画、状態保存・復元 |
| `styles/` / `themes.js` | 独立したスタイルと登録、色定義 |
| `settings-ui.js` / `usability.js` | 設定、案内やフォーカスの補助 |
| `png.js` / `video.js` | 保存専用描画とPNG化、音声付き録画の管理 |
| `tests/` / `docs/` | 自動確認、実ブラウザ用の確認ページ、検証記録 |

新スタイルは[設計書](design.md)の共通契約に従い、`dist/styles/index.js`へ登録します。解析済みの共通データを受け取り、スタイル側で音源を再解析しません。固定シードと曲時刻・固定刻みを使い、描画結果を`Math.random()`や実行時の時計へ依存させないようにします。順再生だけでなく、状態の保存・復元とシークでも同じ結果になることを確認します。

描画・解析結果や状態互換性が変わる場合は、[再現性の基準](issue-13-validation.md)を確認し、対応する解析・描画バージョンやキャッシュの扱いを見直します。モジュールの境界を維持し、スタイル追加のたびに録画・PNG側へ分岐を追加しない構成を保ちます。

## 確認方法と記録

`npm test`はNode標準のテストを使います。Canvasの画素、実際の音、フォーカス、ダウンロード、録画の成功はそれだけでは確認できません。次の記録にあるブラウザ確認ページと条件を使います。

| 変更対象 | 参照する記録 |
| --- | --- |
| 解析・描画・スタイル | [解析](issue-6-validation.md)、[描画基盤](issue-7-validation.md)、[設定全組合せ](issue-12-validation.md) |
| シーク・復元・再現性 | [画素比較](issue-13-validation.md)、[性能・保持量](issue-14-validation.md) |
| MV | [録画](issue-15-validation.md)、[同期・画質](issue-16-validation.md)、[録画ガイド](recording-guide.md) |
| PNG | [現在・曲末の比較と中止](issue-17-validation.md) |
| 実音源・操作性 | [リリース確認](release-checklist.md)、[キーボード・表示・保存](issue-19-validation.md) |

`tests/`のHTMLを使うときは、dist専用の配信を止め、リポジトリ直下から`python -m http.server 8765 --bind 127.0.0.1`で配信します。アプリは`/dist/`、確認ページは各記録に記載された`/tests/...html`で開きます。私用音源をリポジトリへコピーせず、ファイル選択で読み込みます。

OS・ブラウザの版、対象コミット、音源の形式・長さ・容量、設定、結果を記録します。自動操作環境と通常ブラウザ、メモリ内の生成と実ファイル保存を区別します。合成短音の同期測定を長曲や別ブラウザの保証へ広げません。Firefox・Safari等の未確認範囲も残します。

[共通チェック](../.github/workflows/checks.yml)はdev・main宛PRとdevへのpushで、Node.js 24の構文確認・自動テストを実行します。[公開ワークフロー](../.github/workflows/pages.yml)も同じチェックの成功後、mainだけを配信します。マージ前にPRのChecksを確認してください。ブランチ保護の必須チェック設定を自動で変更するものではありません。v1.0公開と公開後確認は[公開準備記録](v1.0-release.md)で追います。

## mainへ公開する

1. 公開対象のdevのコミットを決め、対象Issue・マイルストーン、[リリース確認記録](release-checklist.md)、未確認範囲を照合します。v1.0初回公開は#21の完了条件も確認します。
2. 公開版の表記、READMEと利用ガイドの版の説明、機能・制限を公開対象に合わせます。実音源などが差分に含まれないことを確認します。
3. **head: dev → base: main** の公開用PRを作成し、機能、対象SHA、検証結果、既知の制限、復旧先となる直前のmainのSHAを記録します。日常のdev向けPRと分けてレビューします。
4. 確認後にmainへマージすると、Actionsの「Deploy Sound Canvas to GitHub Pages」が動きます。`dist/`を成果物として配信する構成で、ビルドはありません。Actionsの成功・対象SHA・デプロイURLを確認します。
5. [公開URL](https://sutonomega.github.io/sound-canvas/)を開き、表示版、デモ、曲選択、再生、PNG、短い音声付きMVの生成と保存を確認します。更新されない場合は対象デプロイを確認してから再読み込みします。
6. 公開日時・SHA・結果をPR／確認記録へ残し、条件を満たしたIssue・マイルストーンを完了にします。

Settings → PagesのSourceはGitHub Actionsです。設定を一から変更する必要はありません。手動実行する場合もActionsの実行ブランチは**main**を選びます。devのマージだけでは公開されず、この構成にdev用の公開プレビューURLはありません。[GitHub公式のPagesワークフロー説明](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)も参照できます。

## 公開後に問題が見つかったら

まず、公開URL、問題のSHA、症状・再現手順、直前の正常なSHAを記録します。ワークフローの失敗ならActionsのログと対象SHAを確認し、原因を直して再実行します。成功済みでも実際の画面と保存動作を確認します。

利用へ大きく影響し直前版へ戻す場合は、作業ツリーを空にし、最新のmainから`fix/revert-release-description`等の復旧ブランチを作ります。履歴の強制書き換えは行わず、問題の変更を取り消す新しいコミットを作ります。

- 通常／squashコミットは`git revert 対象SHA`。
- マージコミットは`git show --no-patch --pretty=raw 対象SHA`で親を確認し、親1が戻したいmain側である場合に`git revert -m 1 対象SHA`。
- 競合時は内容を確認して解決します。判断できない場合は`git revert --abort`で中止し、差分と復旧方針を見直します。

これらの対象SHAは実際のコミットに置き換えます。関連変更が複数ある場合、1件の取り消しだけで正常版へ戻るとは限らないため、復旧先との差分を確認します。戻す版で利用できる自動確認とローカル起動・主要操作を確認し、緊急復旧として **base: main** のPRに理由・範囲・確認結果を記録してレビューします。マージ後は通常と同じデプロイ・公開URLの確認を行います。

その後devで原因を修正します。マージのrevertは、後日の再マージで元の変更が自動復活するとは限りません。再公開にはrevertの取り消しや変更の再適用を検討し、mainとの差分全体を再確認します（[Git公式のrevert説明](https://git-scm.com/docs/git-revert)）。復旧コミットとdevの修正を関連Issueから辿れるように残します。

## 不具合報告を受ける・送る

[不具合テンプレート](../.github/ISSUE_TEMPLATE/bug-report.md)を使います。[利用ガイドの報告手順](user-guide.md)に沿い、デモでも再現するか、どの処理段階か、設定や音源の規模を確認します。音源の公開添付を必須にせず、可能なら権利上問題のない短い合成音で再現します。公開ログの個人情報や認証情報も確認します。

修正時は再現条件と期待結果をIssueへ記録し、該当操作と関連する既存操作を確認してdev向けPRへ進めます。公開版へ反映される時期はdevへのマージと分けて説明します。
