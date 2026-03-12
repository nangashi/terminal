---
status: "proposed"
date: 2026-03-12
---

# React の状態管理に useState + useRef を採用

## Context and Problem Statement

Tauri 2 ターミナルアプリのフロントエンドにおいて、タブ・ウィンドウ・ペインツリーという多層ネスト構造の状態管理が App.tsx（約730行）に集中しており、useRef による命令的データ管理（ptyToPane, paneToPty, termRefs 等）の混在が複雑さを増している。今後の機能拡張（設定画面、テーマ、キーバインド設定等）に備え、状態管理戦略を評価・選定する必要がある。

## Prerequisites

* デスクトップフレームワークとして Tauri 2 + React/TypeScript を採用済み (ADR-0001)
* xterm.js の命令的 API との連携が必須（`terminal.onData()` 等に ref パターンを使用）
* 現在の実装規模: App.tsx 約730行、useState 4個、useRef 7個、useCallback 10個、useEffect 5個
* PTY の出力は Tauri イベント経由で非同期に到着し、高頻度で処理される

## Decision Drivers

* ネスト状態の更新しやすさ — タブ > ウィンドウ > ペインツリーという多層構造の部分更新が簡潔に書けるか
* 命令的 API との共存 — xterm.js の ref パターンや PTY マッピング（`useRef<Map>`）との統合のしやすさ
* 高頻度更新時のレンダリング制御 — PTY 出力やリサイズなど高頻度イベントで不要な再レンダリングを抑制できるか
* 実装規模に対する適合性 — 現在の実装規模（App.tsx 約730行、useState 4個等）に対して過剰/過小でないか

## Considered Options

* React useState + useRef（現状維持・構造改善）
* Zustand
* Jotai
* Redux Toolkit (RTK)

## Pros and Cons of the Options

### React useState + useRef（現状維持・構造改善）

* Good, because 現在の3層ネスト（Tab > Window > PaneTree）なら純粋関数（tabStateActions.ts 等）で更新が読みやすく構成されている
* Good, because PTY_OUTPUT_EVENT は termRefs 経由で xterm.js に直接書き込み、React の render cycle を一切引き起こさない
* Good, because xterm.js の ref パターンや PTY マッピングの useRef<Map> が完全に機能しており、命令的 API との統合に問題がない
* Good, because ライブラリ導入不要で依存ゼロ。現在の規模では十分シンプル
* Bad, because ネストが4層以上に深まるとスプレッド演算子の連鎖が冗長化し、更新関数の記述が複雑になる
* Bad, because useRef マップが4つ散在しており、ref state と useState state の二元管理で同期バグのリスクがある
* Bad, because 機能拡張で useState が増加し、App.tsx の God component 化が進む可能性がある

### Zustand

* Good, because immer middleware でネスト状態をミュータブル風に簡潔に記述でき、スプレッド演算子の連鎖を排除できる
* Good, because セレクタベースのサブスクリプションモデルにより、特定のペインの更新が無関係なコンポーネントの再レンダリングを引き起こさない
* Good, because バンドルサイズ ~2.2KB で Provider ラッパー不要。useState パターンに最も近い API で学習コストが低い
* Bad, because xterm.js インスタンスや PTY マッピングなどの非リアクティブデータはストアに置くのが非慣用的で、ストア外に ref を維持する分離管理が必要
* Bad, because 高頻度 PTY イベントのバッチングは自動ではなく、手動設計が必要

### Jotai

* Good, because アトムレベルの粒度でレンダリング最適化が自動的に実現される。ペイン A の PTY 出力がペイン B のコンポーネントを再レンダリングしないことがアーキテクチャとして保証される
* Good, because バンドルサイズ ~2.1KB と軽量。Provider はオプションで段階的導入が可能
* Bad, because ツリー構造（バイナリツリーのペイン分割）をアトム化する設計が複雑で、アトム設計にオーバーヘッドがある
* Bad, because focusAtom の利用には optics-ts + jotai-optics の追加依存とレンズ/プリズムの概念理解が必要で、学習コストが高い

### Redux Toolkit (RTK)

* Good, because Immer 統合の createSlice でネスト状態更新が最も簡潔に書ける
* Good, because Redux DevTools の Time-travel デバッグが複雑なペインツリー操作のデバッグに強力
* Bad, because シリアライズ制約により xterm.js インスタンスや PTY マッピングをストアに格納できず、二重管理が必須
* Bad, because バンドルサイズ ~40KB は現在の規模に対して過大で、action/reducer/selector/middleware の概念的オーバーヘッドも大きい

## Decision Outcome

Chosen option: "React useState + useRef（現状維持・構造改善）", because 命令的 API との共存を最も重視した結果、xterm.js の ref パターンや PTY マッピングとの統合に一切の妥協が不要な現行パターンが最適と判断した。ライブラリ導入による分離管理の複雑さを回避し、現在の実装規模に見合ったシンプルな構成を維持する。規模拡大時には Zustand の導入を検討する。
