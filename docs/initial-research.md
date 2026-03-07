# 初期調査レポート: Windows向けターミナルアプリケーション

## 概要

以下の要件を満たすWindows向けターミナルアプリケーションの実現可能性を調査した。

1. Windows Terminal相当のターミナルエミュレーション
2. WSL2への接続
3. tmuxライクなセッション・ペイン管理
4. cmuxライクな内蔵ブラウザ
5. Claude Codeセッションリストの常時表示・通知・ペインナビゲーション

**結論: 全要件は技術的に実現可能。推奨アーキテクチャはTauri 2.0 (Rust) + xterm.js + WebView2。**

---

## 1. GUIフレームワーク比較

### 比較表

| フレームワーク | アプリサイズ | メモリ (idle) | 起動時間 | WSL2対応 | ブラウザ埋め込み | 成熟度 |
|---|---|---|---|---|---|---|
| **Tauri 2.0** | 2.5-10 MB | 30-50 MB | < 0.5秒 | portable-pty経由 | WebView2 (OS標準) | 高 (v2安定版) |
| **Electron** | 80-150 MB | 150-300 MB | 1-2秒 | node-pty経由 | Chromiumバンドル済 | 非常に高 |
| **WinUI 3 / WPF** | 数MB | 50-100 MB | < 0.5秒 | ConPTY直接 | WebView2 | 非常に高 (Win限定) |
| **Flutter** | 10-20 MB | 50-100 MB | < 1秒 | FFIブリッジ必要 | WebView埋め込み | 中 (デスクトップ) |

### 推奨: Tauri 2.0

- **理由**: 軽量 (Electronの1/10のサイズ、1/5のメモリ)、Rustバックエンドで高性能PTY処理、WebView2でブラウザパネルも実現可能
- **実績**: Terminon (Tauri製ターミナル、WSL統合・スプリットペイン対応)、Terraphim (Electronから移行して大幅性能改善)
- **リスク**: Rustの学習コスト、Windows上でPTY spawnが稀にハングする既知の問題あり、Electron比でプラグインエコシステムが小さい

### 次点: Electron

- Hyper、VS Code、Tabbyで実績多数。プロトタイプ速度は最速だがリソース消費が大きい

---

## 2. ターミナルエミュレーション

### xterm.js (推奨)

- VS Code、Hyper、Azure Cloud Shellなどで利用される業界標準
- WebGL GPU加速レンダラー搭載
- 豊富なアドオン: fit (自動リサイズ)、webgl (GPU描画)、web-links (クリック可能URL)、search、image (Sixel/iTerm2画像)、serialize (状態保存/復元)
- CJK/絵文字/IMEサポート
- Tauri・Electron両方のWebView上で動作

### PTYハンドリング

| ライブラリ | 言語 | 用途 |
|---|---|---|
| **portable-pty** | Rust | Tauri向け推奨。WezTermから抽出、ConPTY対応、月間約90万DL |
| **tauri-plugin-pty** | Rust | Tauri専用プラグイン。portable-ptyをラップ |
| **node-pty** | Node.js | Electron向け推奨。Microsoft公式メンテナンス |
| **alacritty/vte** | Rust | VTパーサー状態機械。エスケープシーケンス解析のみ (端末状態は保持しない) |

---

## 3. WSL2接続

### 推奨方式: `wsl.exe` via ConPTY

Windows Terminalと同じ方式。最もシンプルかつ信頼性が高い。

```
wsl.exe -d <DistributionName> -- <command>
```

1. ConPTY疑似コンソールを作成 (`CreatePseudoConsole()`)
2. `wsl.exe`をConPTYにアタッチして子プロセスとして起動
3. 出力パイプからVTシーケンスを読み取り、入力パイプにキー入力を書き込む
4. ウィンドウリサイズ時は`ResizePseudoConsole()`を呼ぶ

### ディストリビューション列挙: wslapi.dll

`wslapi.dll`で利用可能なWSLディストロを列挙可能。Rustクレート `wslapi` あり。

| 関数 | 用途 |
|---|---|
| `WslIsDistributionRegistered` | ディストロの存在確認 |
| `WslGetDistributionConfiguration` | バージョン・デフォルトUID・フラグ取得 |
| `WslLaunch` | 明示的なハンドル指定でWSLプロセス起動 |

### 注意事項

- ConPTYはWindows 10 1809 (build 17763) 以降が必須
- Windows 10ではマウス入力処理に既知の問題あり (Windows 11で大幅改善)
- 同期I/Oはデッドロックの恐れあり → 非同期I/Oまたは専用リーダー/ライタースレッドを使用

---

## 4. tmuxライクなセッション・ペイン管理

### ペインモデル: バイナリツリー (Windows Terminal方式)

Windows Terminalの[公式スペック](https://github.com/microsoft/terminal/blob/main/doc/specs/%23532%20-%20Panes%20and%20Split%20Windows.md)に基づくバイナリツリーモデル。

```
Pane = Leaf { terminal: TerminalInstance }
     | Split { direction: Vertical | Horizontal, ratio: f64, children: [Pane, Pane] }
```

- Leafをスプリットすると、Parentになり2つのLeaf子ノードを持つ
- ペインを閉じると、兄弟ノードが拡張して空間を埋める
- 各LeafはConPTY + シェルプロセスへの独立した接続を持つ

**Web UI実装**: CSS Flexbox/Grid + `react-resizable-panels`や`allotment`等のライブラリでドラッグリサイズ対応。各ペインにxterm.jsインスタンスを配置。

### セッション永続化

| レベル | 説明 | 複雑度 |
|---|---|---|
| **Level 1: プロセス維持** | アプリがシェルプロセスを保持。アプリクラッシュ時は喪失 | 低 |
| **Level 2: デーモン+ソケット** | バックグラウンドデーモンがPTY接続を所有。GUIは切断/再接続可能 | 中 |
| **Level 3: 状態シリアライズ** | 端末バッファ・スクロールバック・カーソル位置をディスクに保存 | 高 |

**推奨**: Level 1から開始し、必要に応じてLevel 2に拡張。xterm.js serialize addonで状態のスナップショット/復元が可能。

---

## 5. 内蔵ブラウザ

### cmuxの仕組み

cmuxはmacOS向けネイティブターミナルアプリ (Swift/AppKit、Ghosttyベース)。WebKit (Safari) を使ってターミナルペインの横にブラウザパネルを表示する。

- 各「サーフェス」(ターミナルまたはブラウザ)は独立したセッション
- AIエージェントがCLI経由でブラウザを操作可能 (アクセシビリティツリーのスナップショット、クリック、フォーム入力、JS実行)
- Unixドメインソケット経由のJSON APIで通信
- **cmux-windows** (コミュニティポート)がWebView2を使用してWindowsで動作

### Windows実装方式

**Tauri + WebView2の場合**:
- Tauri v2はマルチWebViewウィンドウをサポート (`WebviewWindow` API)
- ただし、単一ウィンドウ内に複数WebViewパネルを埋め込むにはワークアラウンドまたはiframeが必要 (BrowserView相当の機能はissue #2709で要望中)
- 実用的な方式: ターミナルペインはxterm.jsコンポーネント、ブラウザペインはiframeまたは別WebViewウィンドウ

**Electronの場合**:
- `WebContentsView` (v30+、旧BrowserViewの後継) で複数の独立Webコンテンツビューを配置可能
- VS Codeと同じパターン

### リソース影響

各ブラウザパネル追加でレンダラープロセスが増え、50-150 MB/パネルのメモリ増。対策:
- 同時ブラウザパネル数の制限
- バックグラウンドタブのアンロード
- シングルランタイムプロセスの共有

---

## 6. Claude Codeセッション統合

### セッションデータの所在

```
~/.claude/
├── projects/<encoded-path>/
│   ├── <session-id>.jsonl          # セッション会話ログ (権威ソース)
│   └── sessions-index.json         # セッションメタデータインデックス
├── history.jsonl                   # グローバルインデックス (prompt, timestamp, session_id)
├── settings.json                   # グローバル設定 (フック含む)
└── todos/                          # セッション毎のタスクリスト
```

**注意**: `sessions-index.json`は古くなることがある ([issue #25032](https://github.com/anthropics/claude-code/issues/25032))。JSONLトランスクリプトが権威ソース。

### セッション一覧の取得

`claude sessions list`のような組み込みコマンドは存在しない。プログラマティックに取得するには:

1. `~/.claude/projects/` 配下のディレクトリを列挙
2. 各プロジェクトの `sessions-index.json` からメタデータ (セッションID、サマリー、タイムスタンプ、メッセージ数) を取得
3. フォールバック: `.jsonl`ファイルを直接パースし最初/最後の行からセッション境界を判定
4. グローバルインデックス: `~/.claude/history.jsonl`

参考ツール: [cc-sessions](https://github.com/chronologos/cc-sessions) (Rust製、並列スキャン)

### セッション状態の検知

#### 方式A: Claude Code Hooks (推奨、ポーリング不要)

`~/.claude/settings.json`でフック設定:

| フックイベント | トリガー | 用途 |
|---|---|---|
| `Notification` | Claudeがユーザ入力/権限を待機中 | 「注意が必要」アラート |
| `Stop` | Claudeがターンを完了 | 「タスク完了」通知 |
| `SessionEnd` | セッション終了 | クリーンアップ、最終通知 |

`SessionEnd`フックはstdinでJSON (`session_id`, `transcript_path`, `cwd`, `reason`) を受け取る。

#### 方式B: Agent SDK (TypeScript)

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

for await (const message of query({ prompt: "..." })) {
  if (message.type === "result") {
    // session_id, duration_ms, total_cost_usd, subtype: "success"|"failed"|"stopped"
  }
}
```

#### 方式C: stream-jsonサブプロセス

`claude -p --output-format stream-json "prompt"` でNDJSON形式のストリームを取得。`result`タイプのメッセージでセッション完了を検知。

#### 方式D: ファイルシステム監視 (外部セッション用)

`~/.claude/projects/<project>/`を`inotify`/`ReadDirectoryChangesW`で監視。`.jsonl`ファイルの変更を検知し、最終行の`result`メッセージで完了判定。

### セッション状態モデル

| 状態 | 検知方法 | UI表示 |
|---|---|---|
| **Running** | PID存在、resultイベント未受信 | 緑 |
| **Waiting** | `Notification`フック発火 | 黄 |
| **Completed** | `result`イベント (`subtype: "success"`) またはexit code 0 | グレー |
| **Error** | exit code 1/2、または`result`イベント (`subtype: "failed"`) | 赤 |
| **Stopped** | ユーザキャンセル、または`subtype: "stopped"` | グレー |

### デスクトップ通知 (Windows)

| 方式 | 技術 | 備考 |
|---|---|---|
| **Rust crate** | `winrt-toast`, `win-toast-notify` | Tauri向け。アクションボタン+プロトコルアクティベーション対応 |
| **Node.js** | `node-powertoast` | Electron向け。Windowsトースト通知 |
| **WSL interop** | `wsl-notify-send` | WSL内から直接Windows通知を発行 |

**アクショナブル通知**: カスタムURIスキーム (例: `terminal://focus-pane?id=3`) をプロトコルアクティベーションとして登録し、通知クリックで該当ペインにフォーカス。

### ペインとの関連付け

1. ターミナルアプリがペインを作成してClaudeを起動する際、`{ pane_id, session_id, pid }` マッピングを記録
2. `--output-format json`のresultから`session_id`を取得
3. `SessionEnd`フックのstdinペイロードから`session_id`を取得

---

## 7. 既存ターミナルアプリのアーキテクチャ分析

### 主要プロジェクト比較

| プロジェクト | 技術スタック | ペインモデル | セッション永続化 | 特筆事項 |
|---|---|---|---|---|
| **Windows Terminal** | C++/WinRT, XAML, DirectX | バイナリツリー | なし | ConPTY実装のリファレンス、ControlCoreのXAML分離 |
| **Hyper** | Electron, xterm.js, React | プラグインベース | なし | React/Redux構成によるプラグインシステム |
| **Warp** | Rust, Metal/DirectX | 独自UI | なし | Blocks概念 (コマンド+出力のセマンティックグループ)、AI統合 |
| **Tabby** | Electron, Angular, xterm.js | スプリットタブ | SSH設定のみ | 「全てがプラグイン」アーキテクチャ |
| **Alacritty** | Rust, OpenGL | なし (外部tmux推奨) | なし | 最小主義、alacritty_terminalライブラリ分離 |
| **WezTerm** | Rust, OpenGL/Vulkan/Metal, Lua | ツリーベース | デーモン+ソケット | 最も高度な組み込みマルチプレクサ、19+クレート |
| **Rio** | Rust, WebGPU (wgpu), WASM | スプリット | なし | WebGPUで全GPU API統一、WebAssemblyでブラウザ版も可能 |

### 共通アーキテクチャパターン

1. **ターミナルエミュレーションとレンダリングの分離** — 全成功プロジェクトが実施 (alacritty_terminal, wezterm-term, Windows TerminalのControlCore)
2. **ConPTY/PTY抽象化** — シェルへの接続は常に抽象化され、ターミナルは接続先を意識しない
3. **GPUレンダリングは必須** — 全モダンターミナルがGPU加速テキスト描画を使用
4. **設定のコード化** — WezTermのLua設定、WarpのWARP.mdファイルなど、プログラマブル設定への傾向

---

## 8. 推奨アーキテクチャ

### 技術スタック

| レイヤー | 推奨技術 | 理由 |
|---|---|---|
| **GUIフレームワーク** | Tauri 2.0 | 最良の性能/サイズ比、Rustバックエンド、WebView2ベース |
| **フロントエンド** | React + TypeScript | xterm.jsとの親和性、エコシステムの豊富さ |
| **ターミナルエミュレーション** | xterm.js + WebGLアドオン | 業界標準、GPU加速、豊富なアドオン |
| **PTYハンドリング** | portable-pty (Rust) | WezTerm実績、ConPTY対応、クロスプラットフォーム |
| **WSL2接続** | `wsl.exe` via ConPTY + wslapi.dll | Windows Terminal方式、最もシンプルかつ信頼性高 |
| **ペイン管理** | バイナリツリーモデル | Windows Terminalスペック準拠、実装がシンプル |
| **ブラウザパネル** | iframe または Tauri WebviewWindow | WebView2ベースでブラウザ機能を提供 |
| **Claude Code統合** | Hooks + ファイルシステム監視 | ポーリング不要のイベント駆動、外部セッションも検知可能 |
| **デスクトップ通知** | winrt-toast (Rust crate) | Tauriバックエンドから直接呼び出し可能 |

### アーキテクチャ図

```
┌─────────────────────────────────────────────────────────────┐
│                    Tauri Window                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              React Frontend (WebView2)                │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌───────────────┐  │   │
│  │  │  xterm.js   │ │  xterm.js   │ │   Browser     │  │   │
│  │  │  Pane 1     │ │  Pane 2     │ │   Panel       │  │   │
│  │  │             │ │             │ │  (iframe/     │  │   │
│  │  │             │ │             │ │   WebView)    │  │   │
│  │  └─────────────┘ └─────────────┘ └───────────────┘  │   │
│  │  ┌──────────────────────────────────────────────────┐│   │
│  │  │        Claude Code Session List (Sidebar)        ││   │
│  │  │  [✓] Session abc123 - "fix auth bug"    02:31   ││   │
│  │  │  [●] Session def456 - "add API endpoint" 05:12  ││   │
│  │  │  [!] Session ghi789 - "refactor DB"     00:45   ││   │
│  │  └──────────────────────────────────────────────────┘│   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Rust Backend (Tauri Core)                │   │
│  │                                                      │   │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │   │
│  │  │portable- │  │ wslapi   │  │ Claude Session    │  │   │
│  │  │pty       │  │ (distro  │  │ Monitor           │  │   │
│  │  │(ConPTY)  │  │  enum)   │  │ (fs watch +       │  │   │
│  │  │          │  │          │  │  hooks listener)  │  │   │
│  │  └──────────┘  └──────────┘  └───────────────────┘  │   │
│  │                                                      │   │
│  │  ┌──────────────────┐  ┌─────────────────────────┐  │   │
│  │  │ Pane Manager     │  │ Notification Service    │  │   │
│  │  │ (Binary Tree)    │  │ (winrt-toast)           │  │   │
│  │  └──────────────────┘  └─────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
    ConPTY pipes         wslapi.dll        ~/.claude/projects/
         │                    │                    │
    ┌────┴────┐          ┌────┴────┐         ┌────┴────┐
    │ WSL2    │          │ WSL2    │         │ Claude  │
    │ Shell   │          │ Distros │         │ Code    │
    └─────────┘          └─────────┘         │Sessions │
                                             └─────────┘
```

### 開発フェーズ案

| フェーズ | 内容 | 見積もり難易度 |
|---|---|---|
| **Phase 1** | 基本ターミナル: Tauri + xterm.js + portable-pty、WSL2接続、タブ | 中 |
| **Phase 2** | ペイン管理: バイナリツリーモデル、スプリット/リサイズ | 中 |
| **Phase 3** | Claude Code統合: セッションリスト、状態監視、通知 | 中-高 |
| **Phase 4** | 内蔵ブラウザ: ブラウザパネル、ターミナルとの連携 | 中 |
| **Phase 5** | セッション永続化: デーモンアーキテクチャ、状態復元 | 高 |

---

## 9. リスクと課題

| リスク | 影響 | 緩和策 |
|---|---|---|
| Tauri v2のマルチWebView制約 | ブラウザパネルの実装が複雑化 | iframe方式で回避、またはissue #2709の進捗を追跡 |
| Windows上のportable-pty PTY spawnハング | 稀にターミナル接続が失敗 | タイムアウト処理の実装、既知のissueを追跡 |
| `sessions-index.json`の信頼性 | セッション一覧が不完全になる可能性 | JSONLファイル直接パースをフォールバックとして実装 |
| ConPTYのWindows 10互換性 | マウス入力やエスケープシーケンスの問題 | Windows 11を推奨、Windows 10は制限付きサポート |
| Rustの学習コスト | 開発速度の低下 | Rustはバックエンド (PTY/通知) のみ、フロントは慣れたReact/TS |

---

## 10. 参考リソース

### フレームワーク・ライブラリ

- [Tauri 2.0](https://v2.tauri.app/)
- [xterm.js](https://github.com/xtermjs/xterm.js)
- [portable-pty](https://crates.io/crates/portable-pty)
- [tauri-plugin-pty](https://github.com/Tnze/tauri-plugin-pty)
- [Terminon (Tauri製ターミナル)](https://github.com/Shabari-K-S/terminon)

### WSL2・ConPTY

- [ConPTY紹介 (Microsoft)](https://devblogs.microsoft.com/commandline/windows-command-line-introducing-the-windows-pseudo-console-conpty/)
- [ConPTYセッション作成 (Microsoft Learn)](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session)
- [wslapi Rustクレート](https://docs.rs/wslapi)
- [Windows Terminalペインスペック](https://github.com/microsoft/terminal/blob/main/doc/specs/%23532%20-%20Panes%20and%20Split%20Windows.md)

### Claude Code

- [Claude Code Hooks](https://code.claude.com/docs/en/hooks)
- [Agent SDK (TypeScript)](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [cc-sessions](https://github.com/chronologos/cc-sessions)
- [Claude Code ヘッドレスモード](https://code.claude.com/docs/en/headless)

### ブラウザ埋め込み

- [WebView2 (Microsoft)](https://learn.microsoft.com/en-us/microsoft-edge/webview2/)
- [cmux](https://www.cmux.dev/) / [cmux-windows](https://github.com/mkurman/cmux-windows)
- [Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)

### 既存ターミナルアプリ

- [Windows Terminal](https://github.com/microsoft/terminal)
- [WezTerm](https://github.com/wezterm/wezterm)
- [Hyper](https://github.com/vercel/hyper)
- [Tabby](https://github.com/Eugeny/tabby)
- [Alacritty](https://github.com/alacritty/alacritty)
- [Rio Terminal](https://github.com/raphamorim/rio)
- [Warp](https://www.warp.dev/)

### 通知

- [winrt-toast (Rust)](https://lib.rs/crates/winrt-toast)
- [win-toast-notify (Rust)](https://github.com/iKineticate/win-toast-notify)
- [wsl-notify-send](https://github.com/stuartleeks/wsl-notify-send)
