# 実装引き継ぎ書 — フェーズ1(試作)

- 仕様: `docs/spec/20260926-phase1-prototype/spec.md`(凍結済み 2026-09-26)。決定の理由は `decisions.md`。
- 上位仕様: `docs/SPEC.md`、作業ルール: プロジェクト直下 `CLAUDE.md`(日本語・初心者向けに1手順ずつ案内・`.env` は読まない/触らない)。
- 担当想定: 別セッションの実装担当(Sonnet 5)。**本書で自己完結**するように書いてある。仕様と食い違う判断が必要になったら実装を止めてユーザーに質問する(F2)。
- 確認済みの環境: Windows 11、Node v24.15.0、npm 11.12.1。git は未初期化。

## 完了の定義(フェーズ1全体)

ユーザーが iPhone Safari で開発サーバーを開き、①ホームで今日の件数を見て ②新しい単語10語を画像・例文・読み上げ付きで学び ③画像だけで思い出して4段階で評価し ④「日付を1日進める」で翌日の復習が出てくることを確認し、ユーザーが「OK」と言った状態。

## タスク分解と依存関係

| ID | タスク | 依存 | 完了条件 |
|---|---|---|---|
| T1 | リポジトリ準備: `.gitignore` に `.env` `node_modules/` `dist/` を追記(既存の `thinking-dashboard/` は残す)、`git init`、CLAUDE.md の `docs/[SPEC.md](http://SPEC.md)` 2か所を `docs/SPEC.md` に修正(D8。他は変えない) | なし | `git check-ignore .env` が `.env` を返す。`grep -n "SPEC.md" CLAUDE.md` に `[` が無い |
| T2 | Vite + TypeScript(フレームワークなし)の雛形作成、`vitest` 導入。`vite.config.ts` で `server.host: true` | T1 | `npm run build` が exit 0、`npx vitest run` が exit 0 |
| T3 | サンプル20語(A1、画像向き14+向かない6)をユーザーに提案 → 承認後、Claude Code が例文データを作り `data/cards/sample.json` に保存(SPEC 3章の項目+`id`(`<word>-<pos>`)+`target_form`。level は A1 固定) | T1 | ユーザー承認済み。全カードで `target_form` が `sentence_en` に単語境界付きで現れる |
| T4a | ユーザー作業: Pixabay アカウント作成・APIキー取得・`.env` に `PIXABAY_API_KEY=...` を書く(手順を1つずつ案内。**Claude は `.env` を読まない**) | T1(`.gitignore` 済みであること) | ユーザーが「書いた」と報告 |
| T4b | `scripts/fetch-images.mjs`: SPEC 7章③の規則で 20語分取得。候補上位3件のメタ情報を保存、1件目を幅480px WebP(50KB目安)で `public/images/` へ。見つからなければ単語で再検索、なければ `image: null`。safesearch 有効。出典(ページURL・投稿者名)を記録。処理済みはスキップ。1語だけ再取得/候補番号の切替ができる引数を付ける(D7) | T3, T4a | 20語分の画像 or null と credit が揃う。キーがコード・出力・ログに出ない |
| T5 | `scripts/build-deck.mjs`: `data/cards/*.json` と画像情報から `public/data/deck.json` を生成(`{version:1, cards:[...]}`)。`target_form` 検査を含む | T3, T4b | deck.json が生成され検査が通る |
| T6 | 復習ロジック(純粋関数): spec D3・D6・P4 どおり。学習日計算(4時区切り+debugDayOffset)、評価→次回 due/interval/ease、「言えなかった」の3枚後差し込み、今日の出題列(復習上限100→新語10→新語の思い出す) | T2 | vitest で D3 の表の全セル、ease 下限1.3、「言えた」連続で 1→3→8→20→50 日、3枚後差し込み(残り3枚未満なら末尾)、4時前後の日付境界を検証し全件合格 |
| T7 | IndexedDB 層: DB `image-english`、ストア `progress` / `reviewLog` / `meta`(spec D9) | T2 | vitest(`fake-indexeddb`)で保存→読み出しが一致 |
| T8 | UI: 簡易ホーム、4-1 新しい単語、4-2 思い出す(ヒント2段階・答えを見る・4ボタン・画像なしカードは意味+穴埋め)、読み上げ(en-US 優先、最初の再生はタップ起点、自動読み上げオン・速度ふつう固定)。片手操作用に主ボタンは画面下部。ライト/ダーク対応 | T5, T6, T7 | PCブラウザで1日の流れを最後まで操作できる |
| T9 | 開発用「日付を1日進める」操作(`import.meta.env.DEV` のときだけ表示) | T6, T7 | dev で表示、`npm run build` の成果物に含まれない(`grep` で確認) |
| T10 | iPhone 確認手順の案内(PCのIPアドレス確認、`npm run dev`、同じ Wi-Fi の iPhone Safari で `http://<IP>:5173`) | T8, T9 | ユーザーが iPhone で完了の定義①〜④を確認 |

**並列実行できる群**
- T1 完了後: {T2, T3, T4a} を並列(T3 はユーザーの承認待ちを挟む。T4a はユーザー作業)。
- T2 完了後: {T6, T7} を並列。T3+T4a 完了で T4b → T5。
- T8 は T5・T6・T7 がそろってから。T9 は T8 と並行可。

## 触ってよい/いけないファイル

- 触ってよい: `package.json` などの雛形一式、`src/`、`scripts/`、`data/cards/`、`public/`、`tests/`、`vite.config.ts`、`tsconfig*.json`、`.gitignore`(追記のみ)、`CLAUDE.md`(D8 の2か所のみ)。
- 触ってはいけない: `.env`(読み書きとも禁止。存在確認は `test -f .env` のみ可)、`docs/SPEC.md`(D5 の `target_form` 追記はユーザー確認後)、`docs/spec/**`(凍結済み)、`thinking-dashboard/`。
- 実行時に Claude API・有料サービスを呼ぶコードを書かない。APIキーをブラウザ側コードに入れない(`VITE_` 接頭辞の環境変数にしない)。

## 検証手順

1. 自動テスト: `npx vitest run` → 全件合格(失敗は赤の `FAIL` と件数で見える)。
2. ビルド: `npm run build` → exit 0。`grep -r "PIXABAY" dist/` がヒット0件(ヒットしたらキー漏れの疑い、即停止して F4)。`grep -r "日付を1日進める" dist/` もヒット0件。
3. PC 確認: `npm run dev` → ブラウザで完了の定義①〜④を操作。IndexedDB の中身は開発者ツールで確認。
4. iPhone 実機: T10 の手順。http なのでホーム画面追加・オフラインは対象外(フェーズ2)。
- 隔離: 開発サーバーは1つだけ起動する(ポート 5173 が使用中なら既存を止めてから。別ポートで二重起動しない)。
- Windows ファイアウォールの許可ダイアログなど環境固有の罠に当たったら、handoff ではなくプロジェクト `CLAUDE.md` への追記をユーザーに提案する。

## モデル・エスカレーション基準

- **F1 行き詰まり**: 同一問題への修正が2回失敗 → 3回目を試さず Fable(`Agent model:"fable"`、起動エラー時のみ `"opus"`)に根本原因分析を委譲。依頼文テンプレ:「エラーログ全文/試した修正2件と結果/残る仮説。コードは変更せず原因と修正方針を返すこと。未検証の点は明記」。
- **F2 仕様の変更が必要**: 凍結済み spec と食い違う判断が要る → 実装を止め、選択肢2〜3個でユーザーに質問。後戻りしにくいものは Fable に判断材料を依頼。
- **F3 実機往復デバッグ**(iPhone の読み上げ・表示崩れなど): サブエージェントに委譲しない。行き詰まったら「/model で本体を一時的に Fable に切り替える」ことをユーザーに提案。
- **F4 セキュリティ**: キー漏れの疑い・Pixabay 利用条件の解釈 → 作業を止めて Fable に判断を依頼し、ユーザーに報告。
- 共有リソース(起動中の開発サーバー、ユーザーの `.env`)に触る委譲では、依頼文に「開発サーバーを起動しない/`.env` を読まない」を明記する。委譲先の報告は diff・テスト実出力・未検証項目の3点を必須とし、ディスク上の現物で確認してから受け入れる。

## コミット前レビューゲート

- T8 完了後、iPhone 確認(T10)の前に、実装とは別パスのレビューを1回挟む(codex `codex exec ... < /dev/null`、または Fable への依頼)。観点: spec D3/D6 との一致、キー漏れ、`.env` 非参照、dev 専用コードの混入。
- 自己レビューだけで「完了」にしない。コミットはユーザーの依頼があったときだけ行い、`git commit -m "..."` か `-F <file>` を使う(here-string 禁止)。
- 報告は「実装済み/テスト済み/実機検証済み」のどこまで到達したかを明示する。
