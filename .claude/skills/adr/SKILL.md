---
name: adr
description: Create Architecture Decision Records (ADRs) in MADR format. Use this skill whenever the user wants to document an architectural decision, record a technical choice, or create an ADR. Trigger on `/adr`, or when the user mentions "ADR", "architecture decision", "decision record", or wants to document why a particular technology, pattern, or approach was chosen.
allowed-tools: Bash, Glob, Read, Write, AskUserQuestion
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

## Step 2: 次の ADR 番号を決定

Glob で `docs/decisions/*.md` にマッチするファイルを検索する。数値プレフィックス（例: `0001`, `0002`）を解析し、次の連番を決定する。ADR ファイルが存在しない場合は `0001` から開始する。

`docs/decisions/` ディレクトリが存在しない場合は `mkdir -p docs/decisions` で作成する。

## Step 3: 情報を対話的に収集

以下の情報をユーザーから収集する。会話を効率的に進めるため、複数の項目をまとめて質問してもよいが、ADR を生成する前に十分な情報を得ること。トピックで既に提供された情報に応じて質問を調整する。

### 必須情報:
1. **背景と課題（Context and Problem Statement）** — この決定に至った状況や課題は？「どのような背景・課題がありますか？」と質問する
2. **前提条件（Prerequisites）** — この決定が依存する既存の意思決定、採用済み技術、制約は？例: 「Tauri を採用済み（ADR-0001）なので、フロントエンドは webview 上で動作する必要がある」。前提条件が変わればこの決定も見直す必要がある。「この決定の前提となる既存の意思決定や制約はありますか？（例: 採用済みフレームワーク、過去の ADR、インフラ制約）」と質問する
3. **検討した選択肢（Considered Options）** — どのような代替案を評価したか？最低2つ。「どのような選択肢を検討しましたか？」と質問する
4. **各選択肢の長所と短所（Pros and Cons）** — 各選択肢に最低1つずつ Good と Bad を収集する。この比較は最終的な選択の根拠を透明かつレビュー可能にするために不可欠。「各選択肢の長所と短所は何ですか？」と質問する
5. **選択した選択肢と理由（Chosen Option）** — どの選択肢を選び、なぜか？「どの選択肢を選びましたか？その理由は？」と質問する

### 任意情報（提案するが強制しない）:
6. **決定要因（Decision Drivers）** — 決定に影響した主要な要素（例: パフォーマンス要件、チームの専門性、コスト）
7. **結果（Consequences）** — 決定による既知のポジティブ・ネガティブな結果
8. **補足情報（More Information）** — 関連 Issue、ディスカッション、過去の ADR へのリンクなど

必須情報を収集した後、「決定要因、結果、補足情報を追加しますか？（任意です — 現在の情報で ADR を生成できます）」と質問する。

## Step 4: 収集内容の確認

ADR を生成する前に、収集した情報を一覧で提示してユーザーに確認する。抜け漏れや認識のずれがないかチェックする機会を設けることが目的。以下の形式で提示する:

```
📋 ADR の内容を確認します:

**タイトル**: {決定内容を表すタイトル}
**前提条件**: {前提条件のリスト、または「なし」}
**背景・課題**: {要約 1〜2 文}
**検討した選択肢**:
  1. {選択肢1} — Good: {要約} / Bad: {要約}
  2. {選択肢2} — Good: {要約} / Bad: {要約}
  3. ...
**選択**: {選択した選択肢} — 理由: {要約}
{任意項目があれば表示}

この内容で ADR を生成してよいですか？
修正・追加があれば教えてください。
```

ユーザーが確認するポイント:
- **前提条件の漏れ**: 他に依存する ADR や技術はないか？
- **選択肢の漏れ**: 検討すべきだが挙がっていない代替案はないか？
- **Pros/Cons の偏り**: 特定の選択肢の短所が不足していないか？メリットだけ挙がっていないか？
- **事実の正確性**: 記述内容に誤りはないか？

ユーザーが修正を指示した場合は内容を更新し、再度確認する。「OK」や「問題ない」など承認が得られたら次のステップに進む。

## Step 5: ADR ファイルを生成

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
---

# {決定内容を表す短いタイトル}

## Context and Problem Statement

{背景と課題の説明 — 日本語で記述}

## Prerequisites

{この決定が依存する既存の意思決定・採用済み技術・制約を列挙する。前提条件が変わればこの決定も見直す必要がある。}

* {前提条件1、例: "デスクトップフレームワークとして Tauri を採用済み (ADR-0001)"}
* {前提条件2、例: "フロントエンドは webview 上で動作するため、Web 互換のライブラリのみ使用可能"}

## Decision Drivers

* {決定要因1}
* {決定要因2}

## Considered Options

* {選択肢1}
* {選択肢2}
* {選択肢3}

## Pros and Cons of the Options

### {選択肢1}

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
- **常に含める**: Context and Problem Statement, Prerequisites, Considered Options, Pros and Cons of the Options, Decision Outcome
- **ユーザーが情報を提供した場合に含める**: Decision Drivers, Consequences, More Information
- 任意セクションの情報が提供されず、追加も辞退された場合は**セクションごと省略**する — プレースホルダーテキストは残さない
- 前提条件がない場合は Prerequisites セクションに「なし」と記載する — 「前提条件なし」と明記することに情報価値がある

## Step 6: 書き出しと確認

1. `docs/decisions/{NNNN}-{title}.md` にファイルを書き出す
2. 生成した ADR の内容をユーザーに表示する
3. ファイルパスを伝え、変更が必要か確認する
