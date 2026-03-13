---
name: adr
description: Create or supersede Architecture Decision Records (ADRs) in MADR format. Use this skill whenever the user wants to document an architectural decision, record a technical choice, create an ADR, or supersede an existing ADR. Trigger on `/adr`, or when the user mentions "ADR", "architecture decision", "decision record", "supersede", or wants to document why a particular technology, pattern, or approach was chosen.
allowed-tools: Bash, Glob, Read, Write, AskUserQuestion, Agent, WebSearch, WebFetch, mcp__plugin_context7_context7__resolve-library-id, mcp__plugin_context7_context7__query-docs
user-invocable: true
argument-description: "Optional: the decision topic (e.g., 'use React for frontend')"
---

# ADR (Architecture Decision Record) Creator

MADR (Markdown Architectural Decision Records) 形式で ADR を作成する。ADR は重要なアーキテクチャ上の意思決定を、その背景と結果とともに記録する。将来のチームメンバーが「何を」決めたかだけでなく「なぜ」そう決めたかを理解できるようにすることが目的。

**重要: ユーザーとの対話および生成する ADR ファイルの内容は、すべて日本語で行うこと。** テンプレート内の固定構文（frontmatter の `status`、`Good, because` / `Bad, because` / `Chosen option:` など）は英語のまま維持する。

## Step 1: トピックの決定

`$ARGUMENTS` を確認する:
- トピックが指定されている場合（例: `/adr ローカルストレージに SQLite を使用`）、それを出発点にする
- 引数がない場合、ユーザーに「どのアーキテクチャ上の意思決定を記録しますか？」と質問する

トピックにはユーザーが背景情報、選択肢、要件などを含めている場合がある。これらの情報は Step 3 のフレームワーク提案に活用する。

### Supersede の検出

トピックが既存 ADR の見直し・置き換えである場合（例: `/adr 状態管理を Zustand に変更（ADR-0003 を supersede）`）、**supersede モード**として扱う:

1. `docs/adr/` から対象の旧 ADR を Read で読み込む
2. 旧 ADR の Context and Problem Statement、Prerequisites、Decision Drivers を引き継ぎの土台にする
3. Step 3 のフレームワーク提案で「何が変わったか」を Context に含め、旧 ADR の判断軸を再利用または更新する
4. 以降の Step 3〜7 は通常フローと同じだが、frontmatter に `supersedes` を設定する（Step 7 テンプレート参照）

## Step 2: 次の ADR 番号を決定

Glob で `docs/adr/*.md` にマッチするファイルを検索する。数値プレフィックス（例: `0001`, `0002`）を解析し、次の連番を決定する。ADR ファイルが存在しない場合は `0001` から開始する。

`docs/adr/` ディレクトリが存在しない場合は `mkdir -p docs/adr` で作成する。

## Step 3: フレームワークの提案

LLM がトピック・プロジェクト文脈・既存コードから以下を**提案**し、ユーザーの承認を得る。ユーザーに質問して収集するのではなく、LLM が主体的にドラフトする。

### 3a. 選択肢の調査（候補出し）

選択肢を提案する**前に**、最新の候補を把握するための調査を行う。LLM の学習データは古い可能性があるため、このステップは必須。

**調査方法:**
- Agent ツール（subagent_type=Explore または general-purpose）を使い、WebSearch でトピックに関連する現在の主要な選択肢・新興の選択肢を調査する
- 検索クエリ例: `"{トピックのキーワード} comparison 2025"`, `"{トピックのキーワード} alternatives"`, `"best {トピックのキーワード} for {プロジェクトの技術スタック}"`
- context7 プラグインも活用し、プロジェクトで使用中の技術との互換性や最新の推奨事項を確認する
- ユーザーが既に選択肢を指定している場合でも、調査により見落としている有力な代替案がないか確認する

**調査結果の活用:**
- 調査で発見した選択肢を、ユーザー指定の選択肢と合わせて次の提案内容に反映する
- 各選択肢について「なぜ候補に含めたか」の根拠（公式サイト・比較記事・コミュニティでの評価等）を把握しておく

### 3b. 提案する内容:

1. **背景と課題（Context and Problem Statement）** — トピックから読み取れる状況を 1〜2 文でドラフトする
2. **前提条件（Prerequisites）** — この決定が依存する既存の意思決定、採用済み技術、制約を推定して列挙する。既存の ADR（`docs/adr/` 内）やプロジェクト構成を参照する
3. **検討する選択肢（Considered Options）** — ユーザーが言及した選択肢に加え、**Step 3a の調査で発見した有力な代替案**を含める。各選択肢には調査に基づく簡潔な説明（1行）を付記する
4. **判断軸（Decision Drivers）** — 選択肢を評価するための軸を **4つ** 提案する。判断軸はこの決定に固有の具体的な評価基準とする（例: 「PTY 操作のしやすさ」「バイナリサイズ」など）。汎用的すぎる軸（例: 「品質」「コスト」）は避ける

### 提示形式:

```
以下のフレームワークで比較調査を行います:

**背景・課題**: {ドラフト}

**前提条件**:
* {前提条件1}
* {前提条件2}

**検討する選択肢**（調査に基づく）:
1. {選択肢1} — {簡潔な説明と候補に含めた根拠}
2. {選択肢2} — {簡潔な説明と候補に含めた根拠}
3. {選択肢3} — {簡潔な説明と候補に含めた根拠}

**判断軸**:
1. {軸1} — {その軸で何を評価するかの補足}
2. {軸2} — {補足}
3. {軸3} — {補足}
4. {軸4} — {補足}

修正・追加があれば教えてください。問題なければこの内容で調査を開始します。
```

ユーザーが修正を指示した場合は内容を更新し、再度提示する。承認が得られたら次のステップに進む。

## Step 4: 比較調査

承認されたフレームワーク（選択肢 × 判断軸）に基づき、各選択肢を調査する。

### 調査方法:

**選択肢ごとにサブエージェント（Agent ツール）を起動し、並列で調査する。** これによりメインコンテキストの消費を抑える。

各サブエージェントへの指示には以下を含める:
- 調査対象の選択肢
- 承認済みの判断軸（4つ）
- プロジェクトの背景・要件
- 「判断軸ごとに Good/Bad を整理し、軸外の重要な Pros/Cons も追加して返すこと」

サブエージェントは WebSearch、WebFetch、context7 プラグイン等を活用して事実に基づく情報を収集する。

### 調査結果の統合:

各サブエージェントの結果を統合し、以下の形式でユーザーに提示する:

#### 比較表（判断軸 × 選択肢）:

```
| 判断軸 | 選択肢A | 選択肢B | 選択肢C |
|--------|---------|---------|---------|
| 軸1    | ◎ ... | ○ ... | △ ... |
| 軸2    | ○ ... | ◎ ... | ○ ... |
| 軸3    | △ ... | ○ ... | ◎ ... |
| 軸4    | ○ ... | △ ... | ○ ... |
```

◎/○/△ は相対的な優劣を示す目安。絶対評価ではなく選択肢間の比較として使う。

#### 各選択肢の Pros/Cons 詳細:

判断軸に基づく Good/Bad を必ず網羅したうえで、軸外の重要な要素も追加する。

```
### 選択肢A
* Good, because {判断軸1に関する長所}
* Good, because {判断軸2に関する長所}
* Good, because {軸外の長所}
* Bad, because {判断軸3に関する短所}
* Bad, because {軸外の短所}
```

提示後、ユーザーに以下を確認する:
- 事実誤認の指摘
- 追加調査の依頼
- 問題なければ次のステップへ

## Step 5: ユーザーによる判断

比較結果を踏まえ、ユーザーに選択を委ねる:

「比較結果は以上です。どの選択肢を採用しますか？選択の理由も教えてください。」

LLM は判断を**しない**。材料提供に徹し、ユーザーの決定を記録する。

## Step 6: 収集内容の確認

ADR を生成する前に、収集した情報を一覧で提示してユーザーに確認する。

**結果（Consequences）と補足情報（More Information）は LLM が主体的に提案する。** ユーザーに「追加しますか？」と聞くのではなく、比較調査の内容やユーザーの選択理由から推測してドラフトし、確認時に含める。ユーザーが不要と判断すれば削除指示を受ける。

```
ADR の内容を確認します:

**タイトル**: {決定内容を表すタイトル}
**前提条件**: {前提条件のリスト、または「なし」}
**背景・課題**: {要約 1〜2 文}
**判断軸**: {4つの判断軸}
**検討した選択肢**:
  1. {選択肢1} — Good: {要約} / Bad: {要約}
  2. {選択肢2} — Good: {要約} / Bad: {要約}
  3. ...
**選択**: {選択した選択肢} — 理由: {要約}
**結果（提案）**:
  * Good: {ポジティブな結果}
  * Bad: {ネガティブな結果}
**補足情報（提案）**: {関連リンクや参考資料、なければ「なし」}

この内容で ADR を生成してよいですか？
修正・追加・削除があれば教えてください。
```

ユーザーが修正を指示した場合は内容を更新し、再度確認する。承認が得られたら次のステップに進む。

## Step 7: ADR ファイルを生成

ファイル名を構築する: `{NNNN}-{kebab-case-title}.md`
- `NNNN` はゼロ埋め連番
- タイトルは短く説明的な kebab-case（例: `use-sqlite-for-local-storage`）

frontmatter の `date` には当日の日付を使用する。`status` は `"proposed"` に設定する。

### テンプレート

ADR の本文は日本語で記述する。ただし以下の構文は英語のまま維持する:
- frontmatter のキーと値（`status: "proposed"`, `date:`）
- セクション見出し（`## Context and Problem Statement` など）
- Pros/Cons の定型表現（`Good, because` / `Bad, because`）
- Decision Outcome の定型表現（`Chosen option: "..."`, `because`）

```markdown
---
status: "proposed"
date: {YYYY-MM-DD}
supersedes: "NNNN"  # supersede モード時のみ記載。旧 ADR の番号
---

# {決定内容を表す短いタイトル}

## Context and Problem Statement

{背景と課題の説明 — 日本語で記述}

## Prerequisites

{この決定が依存する既存の意思決定・採用済み技術・制約を列挙する。前提条件が変わればこの決定も見直す必要がある。}

* {前提条件1、例: "デスクトップフレームワークとして Tauri を採用済み (ADR-0001)"}
* {前提条件2、例: "フロントエンドは webview 上で動作するため、Web 互換のライブラリのみ使用可能"}

## Decision Drivers

* {判断軸1}
* {判断軸2}
* {判断軸3}
* {判断軸4}

## Considered Options

* {選択肢1}
* {選択肢2}
* {選択肢3}

## Pros and Cons of the Options

### {選択肢1}

{判断軸に基づく評価を必ず網羅し、軸外の要素も追加する}

* Good, because {長所の説明 — 日本語}
* Bad, because {短所の説明 — 日本語}

### {選択肢2}

* Good, because {長所の説明 — 日本語}
* Bad, because {短所の説明 — 日本語}

## Decision Outcome

Chosen option: "{選択した選択肢}", because {選択理由 — 日本語}.

### Consequences

* Good, because {ポジティブな結果 — 日本語}
* Bad, because {ネガティブな結果 — 日本語}

## More Information

{補足情報、リンク、参考資料 — 日本語}
```

### セクション包含ルール:
- **常に含める**: Context and Problem Statement, Prerequisites, Decision Drivers, Considered Options, Pros and Cons of the Options, Decision Outcome
- **LLM が提案し、ユーザーが削除指示しなかった場合に含める**: Consequences, More Information
- ユーザーが削除を指示した場合は**セクションごと省略**する — プレースホルダーテキストは残さない
- 前提条件がない場合は Prerequisites セクションに「なし」と記載する — 「前提条件なし」と明記することに情報価値がある
- Decision Drivers には承認済みの判断軸を記載する

## Step 8: 書き出し

1. `docs/adr/{NNNN}-{title}.md` にファイルを書き出す
2. **supersede モードの場合**: 旧 ADR の frontmatter を更新する
   - `status` を `"superseded"` に変更
   - `superseded-by: "NNNN"` を追加（NNNN は新 ADR の番号）
   - 旧 ADR の本文は一切変更しない
3. ファイルパスを伝える。追加の確認は行わず、ここで完了とする
