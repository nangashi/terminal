---
status: "proposed"
date: 2026-03-12
---

# ターミナルエミュレータライブラリに xterm.js を採用

## Context and Problem Statement

Tauri 2 + React/TypeScript ターミナルアプリのフロントエンドにおいて、VT シーケンスの解釈・描画を担うターミナルエミュレータライブラリを選定する必要がある。

## Prerequisites

* デスクトップフレームワークとして Tauri 2 + React/TypeScript を採用済み (ADR-0001)
* フロントエンドは WebView2 上で動作するため、Web 互換のライブラリのみ使用可能
* Rust バックエンドで PTY/ConPTY を管理し、IPC 経由でフロントエンドにデータ転送する構成

## Decision Drivers

* VT シーケンス互換性 — VT100/VT220/xterm 256色/TrueColor/マウスイベント等の対応範囲と正確性
* 描画パフォーマンス — WebGL/Canvas レンダリングの対応状況、大量出力時のスループットと遅延
* API の拡張性・統合しやすさ — React との統合のしやすさ、アドオン/プラグイン機構、カスタマイズの柔軟性
* エコシステムの成熟度・メンテナンス状況 — コミュニティの規模、リリース頻度、ドキュメント充実度、長期的な持続性

## Considered Options

* xterm.js
* Terminal.js (Gottox)
* Hterm (Google)

## Pros and Cons of the Options

### xterm.js

* Good, because VT100/VT220/256色/TrueColor/マウスイベント(X10/X11/SGR/SGR-Pixels)をフル対応し、OSC 8 ハイパーリンクもサポートしている
* Good, because WebGL2 レンダラーで Canvas 比最大 900% のパフォーマンス向上を実現し、Canvas fallback も提供している
* Good, because Addon アーキテクチャ(Fit/WebGL/Search/Image等)とカスタム CSI/OSC ハンドラー登録で柔軟な拡張が可能。TypeScript 完全対応
* Good, because GitHub 20,100 stars、月次リリース、VS Code/Azure Cloud Shell/JupyterLab 等で採用されており、バンドル 265KB(v5以降30%削減)
* Good, because CJK・絵文字・IME に対応済み
* Bad, because React 公式統合がなく、onData/onResize は命令型で ref パターンが必須（stale closure リスクあり）
* Bad, because Blinking テキスト(SGR 5/6)が未サポートで、VT52 モードも限定的
* Bad, because WebGL コンテキスト喪失時の fallback 設計が必要

### Terminal.js (Gottox)

* Good, because VT100 互換を目指したシンプルな設計で、Node.js/ブラウザ両環境に対応
* Bad, because VT220/256色/TrueColor/マウスイベントの対応状況が不明確でドキュメントが不足している
* Bad, because Canvas/WebGL レンダラーがなく、パフォーマンスベンチマークも未公開
* Bad, because プラグイン機構なし、React 統合ライブラリなし、TypeScript 型定義なし
* Bad, because 5年以上更新なし(最終リリース約2021年)、GitHub 605 stars で事実上メンテナンス終了

### Hterm (Google)

* Good, because Chrome OS/Secure Shell(約80万ユーザー)での長期運用実績があり、VT シーケンス処理の正確性が高い
* Good, because VT100/VT220/256色/TrueColor/マウスイベント(X10/SGR等)に対応している
* Bad, because CJK・IME 対応が弱く、日本語入力に問題がある
* Bad, because DOM レンダリングのみで Canvas/WebGL に非対応。バンドル 663KB(xterm.js の2.6倍)
* Bad, because npm パッケージが実質廃止状態（最終更新11年前、週間DL 22）で、TypeScript 型定義なし、プラグイン機構なし

## Decision Outcome

Chosen option: "xterm.js", because すべての判断軸で他の選択肢を上回っており、総合的に最も優れているため。

### Consequences

* Good, because WebGL レンダラーと Addon エコシステムにより、高性能かつ拡張可能なターミナル描画基盤を確保できる
* Good, because VS Code 等の大規模プロジェクトと同じ基盤を使うことで、VT シーケンス互換性の問題に遭遇した際にコミュニティの知見を活用できる
* Bad, because React との統合に ref パターンが必須となり、stale closure バグへの継続的な注意が必要になる

## More Information

* xterm.js 公式サイト: https://xtermjs.org/
* Supported Terminal Sequences: https://xtermjs.org/docs/api/vtfeatures/
* GitHub: https://github.com/xtermjs/xterm.js
