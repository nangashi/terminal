---
status: "accepted"
date: 2026-03-12
---

# PTY ライブラリとして自前 ConPTY ラッパーを採用

## Context and Problem Statement

Windows 11 向けターミナルエミュレータの PTY 管理に portable-pty v0.8.1 をローカルパッチ付きで使用しているが、依存クレートの古さ（`winapi`、`shared_library`、`lazy_static`、edition 2018）、upstream（wezterm）のメンテナンス停滞、既存バグ（`do_kill` 成否判定逆転、`CREATE_NO_WINDOW` 未適用）により、継続利用の妥当性を検討する必要がある。

## Prerequisites

* デスクトップフレームワークとして Tauri 2 + Rust を採用済み (ADR-0001)
* ターゲットは Windows 11（ConPTY）だが、開発は WSL2 上で行うため Unix PTY も必要
* `CREATE_NO_WINDOW` フラグ追加のためローカルパッチを適用済み

## Decision Drivers

* ConPTY 制御の柔軟性 — `CreateProcessW` フラグや `PSEUDOCONSOLE_*` quirk の制御がどの程度容易か
* クロスプラットフォーム対応 — WSL2 開発環境（Unix PTY）と Windows ターゲットの両方で動作するか
* メンテナンス負担 — ローカルパッチの維持、アップストリームへの追従、自前コードの保守にかかるコスト
* 依存クレートのモダンさ — `windows-sys` vs `winapi`、古い依存の有無、Rust edition の新しさ

## Considered Options

* portable-pty 0.8.1（ローカルパッチ継続）
* portable-pty 0.9.0（最新版へアップグレード）
* winpty-rs
* 自前 ConPTY ラッパー（Alacritty 方式）

## Pros and Cons of the Options

### portable-pty 0.8.1（ローカルパッチ継続）

* Good, because vendored コードの `CreateProcessW` 呼び出しに直接 `CREATE_NO_WINDOW` を追加でき、パッチ箇所が最小限
* Good, because Unix/Windows のクロスプラットフォーム対応が trait ベースで実装済み。WSL2 開発で問題なく動作
* Good, because 月間 94 万 DL、wezterm 本体での実績があり、基本的な PTY 操作の安定性は実証済み
* Bad, because `winapi` 0.3、`shared_library` 0.1、`lazy_static` 1.4、`nix` 0.25、edition 2018 と依存が全面的に旧世代
* Bad, because upstream (wezterm) のメンテナーが個人事情で活動低下中。CREATE_NO_WINDOW の PR もマージ見込みが薄く、永続的な fork メンテナンスが必要
* Bad, because 0.9.0 に致命的バグがあるためアップグレードパスが塞がれており、セキュリティ修正等も取り込みにくい
* Bad, because `do_kill()` の `TerminateProcess` 成否判定が逆転しているバグ、`WinChild::Future` が poll のたびにスレッドを spawn するリソースリークが存在

### portable-pty 0.9.0（最新版へアップグレード）

* Good, because `serial` → `serial2`、`nix` 0.28 への更新など一部の依存が改善
* Good, because `PSEUDOCONSOLE_INHERIT_CURSOR` により ConPTY 起動時の画面クリア問題が解消
* Bad, because `PSEUDOCONSOLE_INHERIT_CURSOR` により ConPTY が `\x1b[6n` を送信し、応答しないとデッドロック ([wezterm/wezterm#6783](https://github.com/wezterm/wezterm/issues/6783))。portable-pty 自体に自動応答機構はなく、利用者側で実装が必須
* Bad, because Windows 24H2 未満で `ClosePseudoConsole` がハングする可能性 ([microsoft/terminal#17688](https://github.com/microsoft/terminal/issues/17688))
* Bad, because #6783 が 0.9.0 リリース後 1 年以上未修正のまま放置されている
* Bad, because `winapi` 0.3、edition 2018 が残存しており、依存のモダン化は不完全

### winpty-rs

* Good, because `windows` crate 0.62（Microsoft 公式最新）、edition 2021 とモダンな依存構成
* Good, because ConPTY + WinPTY デュアルバックエンドで古い Windows へのフォールバック可能
* Bad, because Windows 専用。Unix PTY は全くサポートせず、WSL2 開発環境では別の PTY ライブラリとの統合レイヤーが必要
* Bad, because `CreateProcessW` の creation flags も `CreatePseudoConsole` の quirks flags もハードコードされており、`CREATE_NO_WINDOW` 追加には fork が必須 ([Issue #82](https://github.com/andfoy/winpty-rs/issues/82) 放置中)
* Bad, because `new()` 時に `AllocConsole` + `SetStdHandle` で親プロセスの標準ストリームを書き換える副作用があり、Tauri の WebView に影響するリスク

### 自前 ConPTY ラッパー（Alacritty 方式）

* Good, because `CreateProcessW` の flags と `PSEUDOCONSOLE_*` quirks を完全に制御でき、`CREATE_NO_WINDOW` をパッチなしで設定可能
* Good, because upstream 追従の問題が消滅し、バグ修正やフラグ変更を即座にデプロイ可能
* Good, because 不要な抽象（CommandBuilder 757 行、serial 299 行）を省き、400-600 行で完結する見込み
* Good, because `windows-sys` + `rustix-openpty` でモダンな依存構成。`winapi`/`shared_library`/`lazy_static` が不要
* Bad, because ConPTY の edge case（`ClosePseudoConsole` の drain 待ちデッドロック等）を自力で対処する責任がある
* Bad, because Windows と Unix で共有コードがほぼゼロの 2 つの実装を保守する必要がある

## Decision Outcome

Chosen option: "自前 ConPTY ラッパー（Alacritty 方式）", because 次点候補の portable-pty が事実上メンテナンス停止しており、他に有力な選択肢がないため。

### Consequences

* Good, because `CREATE_NO_WINDOW` やプロセスフラグをパッチなしで制御でき、Windows 11 固有の問題に即座に対応できる
* Good, because `winapi` → `windows-sys`、`lazy_static` → `LazyLock` 等の技術的負債を一掃できる
* Good, because portable-pty の既知バグ（`do_kill` 成否逆転、Future のスレッド増殖、PATH 上書き）を持ち込まない
* Bad, because ConPTY の edge case（`ClosePseudoConsole` デッドロック等）を自力で発見・対処する責任が生じる
* Bad, because Windows と Unix で共有コードがほぼゼロの 2 実装を保守する必要がある

## More Information

* 参照実装: [Alacritty tty module](https://github.com/alacritty/alacritty/tree/master/alacritty_terminal/src/tty)
* portable-pty 0.9.0 の致命的バグ: [wezterm/wezterm#6783](https://github.com/wezterm/wezterm/issues/6783)
* ConPTY `ClosePseudoConsole` ハング: [microsoft/terminal#17688](https://github.com/microsoft/terminal/issues/17688)
* portable-pty メンテナンス状況: [wezterm/wezterm#7451](https://github.com/wezterm/wezterm/issues/7451)
