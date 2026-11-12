# v1.0 開発ロードマップ

## 現状と完成の定義

2026-11-12: 0.1試作品をGitHub Pagesで公開し、利用者による動作確認済み。MP3/WAV、簡易事前解析、再生/一時停止/シーク、有機的曲線、設定、PNGは実装済み。既存機能は検証・改善として扱う。盛り上がり、3層構成、残り3スタイル、動画は未実装。

v1.0は「自作曲を読み込み、4スタイルから選び、音声付きWebMと完成アートPNGを3比率で保存できる」初期仕様の完成を指す。M1〜M4の必須Issueを完了し、公開URLで確認する。将来案を完成条件に加えない。期限・担当者は未設定。

## マイルストーンとIssue

### [M1：企画・仕様・設計](https://github.com/sutonomega/sound-canvas/milestone/1)

- [#1 [企画] v1.0の対象ユーザー・完成条件・公開範囲を定める](https://github.com/sutonomega/sound-canvas/issues/1)
- [#2 [仕様] 音楽解析・操作・出力・再現性の仕様書を整備する](https://github.com/sutonomega/sound-canvas/issues/2)
- [#3 [設計] 解析・3層描画・スタイル・出力の共通契約を設計する](https://github.com/sutonomega/sound-canvas/issues/3)
- [#4 [運用] dev・PR・レビュー・文書更新の開発手順を整える](https://github.com/sutonomega/sound-canvas/issues/4)

### [M2：音楽解析と4種類の描画表現](https://github.com/sutonomega/sound-canvas/milestone/2)

- [#5 [音楽] 読み込み・解析・再生の状態管理と失敗時の復旧を安定化する](https://github.com/sutonomega/sound-canvas/issues/5)
- [#6 [解析] 帯域・ビート・盛り上がりと平滑化を共通データに整える](https://github.com/sutonomega/sound-canvas/issues/6)
- [#7 [描画基盤] 背景・蓄積・演出の3層とスタイル共通インターフェースを実装する](https://github.com/sutonomega/sound-canvas/issues/7)
- [#8 [描画] 有機的な曲線の音楽反応と完成アートを磨く](https://github.com/sutonomega/sound-canvas/issues/8)
- [#9 [描画] 幾何学模様スタイルを追加する](https://github.com/sutonomega/sound-canvas/issues/9)
- [#10 [描画] 粒子アートスタイルを追加する](https://github.com/sutonomega/sound-canvas/issues/10)
- [#11 [描画] 簡易流体・水彩スタイルを追加する](https://github.com/sutonomega/sound-canvas/issues/11)
- [#12 [設定] 4スタイル・テーマ・反応・軌跡・比率の設定を統合する](https://github.com/sutonomega/sound-canvas/issues/12)

### [M3：再現性とMV制作](https://github.com/sutonomega/sound-canvas/milestone/3)

- [#13 [再現性] 固定シード・固定時間刻み・シーク復元の一致を検証する](https://github.com/sutonomega/sound-canvas/issues/13)
- [#14 [性能] シーク時の再計算を軽量化し復元中の操作を整える](https://github.com/sutonomega/sound-canvas/issues/14)
- [#15 [動画] 音声付きWebMの録画・停止・ダウンロードを実装する](https://github.com/sutonomega/sound-canvas/issues/15)
- [#16 [出力検証] プレビューとWebMの同期・画質・3比率を確認する](https://github.com/sutonomega/sound-canvas/issues/16)
- [#17 [PNG] 現在の画像と曲末の完成アートを確実に保存する](https://github.com/sutonomega/sound-canvas/issues/17)

### [M4：v1.0公開準備](https://github.com/sutonomega/sound-canvas/milestone/4)

- [#18 [検証] 実音源・長曲・主要PCブラウザで制作フローを確認する](https://github.com/sutonomega/sound-canvas/issues/18)
- [#19 [UI] 操作性・キーボード・日本語表示を仕上げる](https://github.com/sutonomega/sound-canvas/issues/19)
- [#20 [ドキュメント] 使い方・開発・公開・不具合報告の手順を整備する](https://github.com/sutonomega/sound-canvas/issues/20)
- [#21 [公開] CI・リリースチェックを整えてv1.0を公開する](https://github.com/sutonomega/sound-canvas/issues/21)

## 着手順

### M1の進捗（2026-11-12）

- #4：PR #23がdevにマージされ、運用整備の完了条件を確認してクローズ済み。
- #1〜#3：PR #24がdevにマージ済み。[公開範囲](service-scope.md)・[仕様](spec.md)・[設計](design.md)を確認し、M1の文書整備を完了。
- M2以降の機能は未実装・未検証の範囲を含む。M1文書の作成を機能完成として扱わない。

### M2の進捗（2026-11-12）

- #5：PR #25がdevにマージ済み。読込候補の確定、処理の中断・世代管理、連続シーク、曲末からの再生を実装。[確認記録](issue-5-validation.md)を参照。
- #6：PR #26がdevにマージ済み。チャンネル別帯域解析、ビート間隔、intensity、全PCM由来の識別を実装。[確認記録](issue-6-validation.md)を参照。
- #7：PR #27がdevにマージ済み。3層合成、スタイル登録、固定刻み、内部状態と描画面の保存/復元を実装。[確認記録](issue-7-validation.md)を参照。
- #8：PR #28がdevにマージ済み。音量・帯域・ビート・盛り上がりの曲線反応、白飛び対策、3比率の余白を調整。[比較画像と確認記録](issue-8-validation.md)を参照。
- #9：PR #29がdevにマージ済み。幾何学模様と曲線の単独切替、音楽反応、全テーマ・比率・軌跡を実装。[比較画像と確認記録](issue-9-validation.md)を参照。
- #10：PR #30がdevにマージ済み。粒子の発生・拡散・寿命、状態復元と単独切替を実装。[比較画像と確認記録](issue-10-validation.md)を参照。
- #11：半透明のにじみ・顔料・ビート演出、全テーマと軌跡の5分描画を実装・確認。[比較画像と確認記録](issue-11-validation.md)を参照。devへの統合前はIssueを閉じない。

まず #4 の運用整備と #1 → #2 → #3 の企画・仕様・設計を進める。その後 #5〜#7 の安定化・解析・描画基盤を用意し、#8〜#11 の表現、#12 の設定を統合する。#13 の再現性を基準に復元性能・動画・PNGを整え、M4で検証・ガイド・v1.0公開を行う。個別の依存関係は各Issueを正とする。

順序や範囲を変更するときはIssue・マイルストーン・本書を一緒に更新する。MVを先行検証したい場合などは依存関係を見直し、合意した変更を記録してから進める。

## 将来拡張

[#22](https://github.com/sutonomega/sound-canvas/issues/22) でMP4、歌詞、曲名表示、レイヤー合成、プリセット保存、サビ演出、短尺切り抜きを管理する。v1.0の必須マイルストーンには割り当てない。

## 運用

[開発手順](project-workflow.md)に従い、作業ブランチ → dev宛PR → 条件確認 → 公開時にmain反映と進める。文書PRの作成とマージは区別し、マージしていない文書や未確認事項を完了扱いにしない。

