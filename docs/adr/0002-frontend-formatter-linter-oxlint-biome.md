---
status: "proposed"
date: 2026-03-12
---

# フロントエンドのフォーマッタ・リンター構成に OxLint + Biome を採用

## Context and Problem Statement

Tauri 2 + React/TypeScript + Rust プロジェクトにおいて、フロントエンド（TypeScript/React）のフォーマッタ・リンター構成を選定する必要がある。Rust 側は clippy + rustfmt + cargo-deny がデファクトスタンダードであり選択の余地が少ないため、本 ADR ではフロントエンド側のツール選定に焦点を当てる。

## Prerequisites

* デスクトップフレームワークとして Tauri 2 + React/TypeScript を採用済み (ADR-0001)
* タスクランナーとして just を使用し、`just lint` / `just fmt` で統一的にチェック・整形を実行する運用
* Rust 側は clippy + rustfmt + cargo-deny を使用（本 ADR のスコープ外）

## Decision Drivers

* 実行速度 — CI およびローカル開発での lint/format の実行時間。Rust バックエンドのコンパイル待ちと並行するため、フロントエンド側のボトルネック度合い
* React/TypeScript ルールの網羅性 — React Hooks ルール（exhaustive-deps 等）、TypeScript 固有のルール、カスタムアーキテクチャルール（レイヤー境界制約など）のサポート範囲
* 設定の簡潔さと保守性 — 設定ファイルの数・複雑さ、ツール間の競合リスク、依存パッケージ数
* エコシステムの成熟度と将来性 — プラグイン・ルールの充実度、コミュニティサイズ、開発の活発さ、長期的な安定性

## Considered Options

* OxLint + Biome（OxLint でリント、Biome でフォーマット）
* Biome 単体（リント + フォーマットを Biome に統合）
* ESLint + Prettier（従来の標準構成）

## Pros and Cons of the Options

### OxLint + Biome

* Good, because lint 速度が ESLint 比 50-100x、Biome linter 比でも約 2x 高速で、CI・ローカル開発のフィードバックが最速
* Good, because Biome formatter は Prettier 比 20-100x 高速（10,000 ファイルを 0.3 秒で処理）
* Good, because 696 ルール内蔵で、react/rules-of-hooks、react/exhaustive-deps、no-restricted-imports（レイヤー境界制約）をすべてサポート済み
* Good, because npm 依存 2 個・設定 2 ファイルで、ESLint + Prettier の 7-10 個と比べ大幅にシンプル
* Good, because VoidZero（$17M+ 資金、Evan You 創設）が開発を支援しており、長期的な持続性が高い
* Good, because Oxfmt（beta）が登場しており、将来的に Oxc 単一エコシステムへの統合が期待できる
* Bad, because exhaustive-deps の挙動が ESLint 版と一部異なる（false positive/negative の報告あり）
* Bad, because 型対応リンティングはまだ alpha 段階で本番安定性が保証されない
* Bad, because 2 ツール独立運用のため統一的な check コマンドがなく、個別に実行が必要

### Biome 単体

* Good, because 単一ツール・単一設定ファイルで lint + format + import 整理を完結でき、最もシンプルな構成
* Good, because npm 依存 1 個のみで、依存関係の管理・アップデートが最も容易
* Good, because ツール間の競合リスクがゼロで、設定の不整合が起きない
* Bad, because noRestrictedImports が glob パターン未対応で、ファイルパスベースのレイヤー境界制約が困難
* Bad, because eslint-plugin-boundaries 相当のモジュール境界ルールが存在しない
* Bad, because ルール総数 455+ は OxLint の 696 や ESLint エコシステムと比べて少ない
* Bad, because プラグインシステムは GritQL ベースで診断のみ（自動修正不可）、配布機能もまだない

### ESLint + Prettier

* Good, because 型対応リンティングが最も成熟（typescript-eslint で 59 ルール、本番実績豊富）
* Good, because eslint-plugin-boundaries でゾーンベースのアーキテクチャ制約を表現力高く定義可能
* Good, because 100M+ DL/週、10 年以上の歴史、膨大な Stack Overflow・チュートリアルの蓄積
* Bad, because 実行速度が OxLint 比 50-100x 遅く、CI・エディタのフィードバック遅延が顕著
* Bad, because npm 依存 7-10 個、設定ファイル 3 つ以上、プラグイン間の互換性管理が煩雑
* Bad, because ESLint のフォーマットルールと Prettier の競合を eslint-config-prettier で抑制する必要があり、設定順序ミスで不整合が発生
* Bad, because eslint-config-prettier にサプライチェーン攻撃の事例あり（CVE-2025-54313、Windows 対象）

## Decision Outcome

Chosen option: "OxLint + Biome", because 実行速度と React/TypeScript ルールの網羅性を重視した結果、この組み合わせが最も優れていた。OxLint は ESLint 比 50-100x の速度で 696 ルールを提供し、レイヤー境界制約を含むプロジェクト固有のアーキテクチャルールもサポートする。Biome は Prettier 比 20-100x 高速なフォーマッタとして、OxLint との責務分離（リント/フォーマット）が明確で競合リスクもない。
