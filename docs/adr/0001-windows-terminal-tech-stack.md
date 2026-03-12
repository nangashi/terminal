---
status: "proposed"
date: 2026-03-12
---

# Windows ターミナルアプリケーションの技術スタック選定

## Context and Problem Statement

Windows 11 で動作するターミナルエミュレータを新規開発するにあたり、システム層（PTY/ConPTY 管理）から UI 層（マルチタブ・ペイン分割）までをカバーする技術スタックを選定する必要がある。開発者は Rust と Web 技術（React/TypeScript）の経験を持つ。

## Prerequisites

* なし（プロジェクト最初の技術選定であり、依存する既存の意思決定はない）

## Decision Drivers

* PTY/ConPTY 操作との親和性 — システム API へのアクセスのしやすさ、ConPTY の制御やプロセス管理における言語・フレームワークの適性
* リソース効率 — バイナリサイズ、メモリ使用量、起動速度など、常駐アプリとしてのフットプリント
* AI 開発との親和性 — LLM（Claude 等）によるコード生成・修正のしやすさ、AI エージェントが扱いやすい言語・フレームワークか
* ターミナルエミュレーション基盤の成熟度 — VT シーケンス処理・描画を担うライブラリの完成度と、そのスタックでの利用可否

## Considered Options

* Tauri 2 + Rust + React/TypeScript
* Electron + Node.js + React/TypeScript
* WPF/WinUI 3 + C#/.NET
* Rust フルネイティブ（wezterm 方式: wgpu 等で GUI も自前描画）

## Pros and Cons of the Options

### Tauri 2 + Rust + React/TypeScript

* Good, because Rust バックエンドから portable-pty 等で ConPTY を直接制御でき、IPC 経由でフロントエンドへ効率的にデータ転送できる
* Good, because バイナリサイズ 5-15MB と軽量。Windows 11 には WebView2 がプリインストールされており配布問題がない
* Good, because フロントエンド（TS/React）は LLM の最も得意な領域であり、AI エージェントによる UI 層の開発生産性が高い
* Good, because xterm.js を TypeScript/React フロントエンドでそのまま利用でき、WebGL レンダリングやアドオンエコシステムの恩恵を受けられる
* Good, because Rust のメモリ安全性により、PTY 管理などシステムレベル処理のセキュリティリスクを言語レベルで排除できる
* Bad, because Rust 部分の LLM コード生成精度は TypeScript と比較して低く、所有権・ライフタイム等の Rust 固有概念で AI が誤りやすい
* Bad, because PTY 出力を IPC 経由でフロントエンドに渡す余分なレイヤーがあり、大量出力時にオーバーヘッドが顕在化する可能性がある
* Bad, because WebView の GPU 描画（WebGL）にラグが報告される事例がある

### Electron + Node.js + React/TypeScript

* Good, because node-pty（Microsoft 製）が事実上の標準で、ConPTY を直接サポート。VS Code・Hyper 等で豊富な実績がある
* Good, because JS/TS は LLM の学習データが最も豊富で、全層が単一言語のため AI が扱いやすい
* Good, because xterm.js + Electron は最も実績のある組み合わせであり、エッジケースの多くが既に発見・修正されている
* Bad, because Chromium + Node.js をバンドルするため、バイナリ 80-120MB、メモリ 200-500MB、起動 2-5 秒と常駐アプリには過大
* Bad, because node-pty はネイティブ C++ アドオンで、Electron バージョンに合わせた electron-rebuild が必要
* Bad, because node-pty はスレッドセーフでなく、Node.js のシングルスレッドモデルの制約を受ける
* Bad, because Hyper の開発が停滞しており、Electron + ターミナルの持続性にリスクがある

### WPF/WinUI 3 + C#/.NET

* Good, because C# から CsWin32 ソースジェネレータで ConPTY API の型安全な P/Invoke バインディングを自動生成できる
* Good, because Fluent Design System、Mica/Acrylic、ダークモード等の Windows 11 ネイティブ UI 統合が自然に行える
* Bad, because .NET に成熟した VT シーケンスパーサー/レンダリングライブラリが事実上存在しない（XtermSharp は 2020 年以降メンテ停止）
* Bad, because ConPTY の P/Invoke 実装は低レベル構造体のマーシャリングが複雑で、成功事例が限られる
* Bad, because Native AOT は WPF/WinUI 非対応。GC ポーズがターミナルの低レイテンシ要件に影響するリスクがある
* Bad, because Windows 専用でクロスプラットフォーム展開の可能性を閉ざす
* Bad, because 開発者の C#/.NET 経験が限定的で、学習コストが高い

### Rust フルネイティブ（wezterm 方式）

* Good, because バイナリ約 6MB、最小メモリ、GC なし。GPU 直接描画で描画パフォーマンスが最高
* Good, because Rust から ConPTY を直接呼び出し可能。portable-pty / windows-sys 等の実績あるクレートが利用可能
* Good, because vte + alacritty_terminal 等、VT パーサー・ターミナルグリッドの成熟したクレートが存在する
* Good, because 単一言語（Rust）で全スタックを構成でき、Cargo だけでビルドが完結する
* Bad, because GUI 描画コード（wgpu シェーダー、テクスチャアトラス、グリフキャッシュ）は LLM が最も苦手な領域
* Bad, because タブバー・ペイン分割・スクロールバー・設定画面等のリッチ UI を全て低レベルから自前構築する必要がある。WezTerm は 8,564 コミット、389 コントリビューターを要した
* Bad, because フォントレンダリングスタックの自前構築が必要（DirectWrite/CoreText/FreeType 統合、CJK 幅計算、リガチャ、カラー絵文字）
* Bad, because HMR がなく、GUI 変更のたびに Rust の再コンパイルが必要。開発イテレーション速度が大幅に低下する

## Decision Outcome

Chosen option: "Tauri 2 + Rust + React/TypeScript", because ターミナルエミュレーション基盤の成熟度を必須条件としたうえで、リソース効率と PTY/ConPTY 操作との親和性を重視した結果、これらの軸で総合的に最も優れていた。xterm.js による成熟したターミナルエミュレーション基盤をそのまま活用でき、Rust バックエンドで ConPTY を直接制御しつつ、Electron と比較して大幅に軽量なフットプリントを実現できる。
