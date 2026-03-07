# 技術スタック

## 概要

本プロジェクトは、Windows向けターミナルアプリケーションを以下の技術スタックで構築する。

| レイヤー | 技術 | バージョン |
|---|---|---|
| アプリフレームワーク | Tauri 2.0 | v2 stable |
| バックエンド | Rust | stable (rust-toolchain.tomlで固定) |
| フロントエンド | React 19 + TypeScript 5.9 | 19.2.x / 5.9.x |
| ターミナルエミュレーション | xterm.js (WebGLレンダラー) | latest |
| PTYハンドリング | portable-pty | latest |
| ビルド/バンドル | Vite 7 (Rolldown) | 7.x |
| スタイリング | Tailwind CSS v4 | 4.x |
| 状態管理 | Zustand | latest |
| パッケージマネージャ | pnpm | 9.x |
| ツール管理 | mise | latest |

---

## 1. アプリフレームワーク: Tauri 2.0

### 選定理由

initial-research.mdの調査結果から、Tauri 2.0を選定した。

| 比較項目 | Tauri 2.0 | Electron | WinUI 3 |
|---|---|---|---|
| アプリサイズ | 2.5-10 MB | 80-150 MB | 数MB |
| メモリ (idle) | 30-50 MB | 150-300 MB | 50-100 MB |
| 起動時間 | < 0.5秒 | 1-2秒 | < 0.5秒 |
| クロスプラットフォーム | Win/Mac/Linux | Win/Mac/Linux | Windowsのみ |
| ブラウザ埋め込み | WebView2 (OS標準) | Chromiumバンドル | WebView2 |
| 学習コスト | 中 (Rust) | 低 (JS/TS) | 高 (C#/C++) |

- Electronの1/10のサイズ、1/5のメモリで同等機能を実現可能
- Rustバックエンドで高性能PTY処理 (portable-ptyクレート)
- WebView2をOS標準として利用し、ブラウザパネルも実現可能
- Terminon (Tauri製ターミナル) で実績あり

### リスクと対策

| リスク | 対策 |
|---|---|
| Rustの学習コスト | バックエンド (PTY/通知) のみRust、フロントエンドはReact/TS |
| マルチWebView制約 (issue #2709) | ブラウザパネルはiframe方式で回避 |
| PTY spawnの稀なハング | タイムアウト処理の実装 |

---

## 2. バックエンド: Rust

### ツールチェーン管理

**rustup + rust-toolchain.toml** でチーム全体のRustバージョンを固定する。

```toml
# rust-toolchain.toml
[toolchain]
channel = "1.84.0"
components = ["rustfmt", "clippy", "llvm-tools-preview"]
targets = ["x86_64-pc-windows-msvc"]
```

### 主要クレート

| クレート | 用途 |
|---|---|
| portable-pty | PTY抽象化 (ConPTY on Windows)。WezTerm由来、月間約90万DL |
| tauri | アプリフレームワークコア |
| wslapi | WSL2ディストリビューション列挙 |
| winrt-toast | Windowsデスクトップ通知 |
| serde / serde_json | シリアライゼーション |
| tokio | 非同期ランタイム |
| notify | ファイルシステム監視 (Claude Codeセッション検知) |

### Lint / Formatter / 静的解析

| ツール | 用途 | 設定 |
|---|---|---|
| **clippy** | Linter | pedanticグループを有効化 |
| **rustfmt** | Formatter | style_edition = "2024" |
| **cargo-deny** | 依存関係監査 (脆弱性・ライセンス・重複) | deny.toml |
| **cargo-machete** | 未使用依存検出 (高速・regex) | pre-commitで実行 |
| **cargo-udeps** | 未使用依存検出 (正確・nightly) | 定期監査で実行 |

**clippy設定** (`Cargo.toml`の`[lints]`セクション):

```toml
[lints.clippy]
pedantic = "warn"
module_name_repetitions = "allow"
```

**rustfmt設定** (`rustfmt.toml`):

```toml
style_edition = "2024"
max_width = 100
use_field_init_shorthand = true
```

**cargo-deny設定** (`deny.toml`):

```toml
[advisories]
vulnerability = "deny"
unmaintained = "warn"

[licenses]
allow = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"]
confidence-threshold = 0.8

[bans]
multiple-versions = "warn"
wildcards = "deny"

[sources]
unknown-registry = "deny"
unknown-git = "deny"
```

### テスト

| カテゴリ | ツール | 用途 |
|---|---|---|
| テストランナー | **cargo-nextest** | 標準`cargo test`比30%高速、リトライ・遅延テスト検出・CIシャーディング対応 |
| ユニットテスト | 標準 `#[test]` + **rstest** | rstest: フィクスチャベース・パラメータ化テスト |
| プロパティテスト | **proptest** | ランダム入力によるインバリアント検証 |
| Tauri統合テスト | `tauri::test` mockランタイム | WebViewなしでTauriコマンドをテスト |
| カバレッジ | **cargo-llvm-cov** | LLVMソースベース計測、クロスプラットフォーム対応 |

**cargo-nextest設定** (`.config/nextest.toml`):

```toml
[profile.default]
retries = 2
slow-timeout = { period = "60s", terminate-after = 2 }
fail-fast = false

[profile.ci]
retries = { backoff = "exponential", count = 3, delay = "1s", max-delay = "10s" }
```

---

## 3. フロントエンド: React + TypeScript

### React 19 + React Compiler

- React 19.2.x (stable) を採用
- **React Compiler v1.0**: ビルド時自動メモ化。手動の`useMemo`/`useCallback`が不要に
- eslint-plugin-react-hooksにCompilerルールが統合済み

### TypeScript 5.9

- `strict: true` で全strict系フラグを有効化
- `tsc --noEmit` をCIおよびpre-commitで実行し型エラーを検出

**tsconfig.json**:

```jsonc
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

### ビルドツール: Vite 7

- Tauri公式推奨のフロントエンドビルドツール
- Rolldown (Rust製バンドラー) による高速ビルド
- xterm.jsやReactとの統合が成熟

### スタイリング: Tailwind CSS v4

- Rust製Oxideエンジンで5x高速フルビルド、100x高速インクリメンタルビルド
- CSS-firstの設定 (`@theme`ディレクティブ)。`tailwind.config.js`不要
- ターミナルUIのような精密なレイアウトにユーティリティファーストが有効

### 状態管理: Zustand

- 1.16KB gzippedの軽量ストア
- Provider不要、最小限のボイラープレート
- ターミナルセッション、設定、接続状態などのグローバル状態管理に適する

### Lint / Formatter / 静的解析

| ツール | 用途 | 設定 |
|---|---|---|
| **ESLint 9** (flat config) | Linter | typescript-eslint v8 + react-hooks |
| **Prettier** | Formatter | 標準設定 |
| **tsc --noEmit** | 型チェック | CI + pre-commitで実行 |

**ESLint設定** (`eslint.config.mjs`):

```js
import { defineConfig } from "eslint/config";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default defineConfig([
  { ignores: ["dist/", "src-tauri/", "coverage/"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
]);
```

### テスト

| カテゴリ | ツール | 用途 |
|---|---|---|
| ユニットテスト | **Vitest** + React Testing Library | Viteネイティブ、Jest互換API、10-20x高速 |
| フロントエンドモック | `@tauri-apps/api/mocks` | `mockIPC()`でTauriコマンド呼び出しをモック |
| E2Eテスト | **Playwright** | 後述のE2E戦略を参照 |

---

## 4. E2Eテスト戦略

### 多層テストアプローチ

```
Layer 1: Rust ユニットテスト (cargo-nextest + rstest)
  └─ PTYロジック、Tauriコマンド、セッション管理

Layer 2: フロントエンド ユニットテスト (Vitest + React Testing Library)
  └─ UIコンポーネント、状態管理、IPC通信のモック

Layer 3: Tauri統合テスト (tauri::test + mockIPC)
  └─ Rust-JS間のIPC通信、コマンドハンドラー

Layer 4: E2Eテスト (Playwright + WebDriver)
  └─ アプリ全体のユーザーフロー

Layer 5: ビジュアルリグレッション (Playwright screenshots)
  └─ ターミナル表示の視覚的整合性
```

### E2Eテスト方式

| 方式 | プラットフォーム | 用途 |
|---|---|---|
| **tauri-driver + WebdriverIO** | Linux, Windows | 公式推奨のWebDriverベースE2E |
| **Playwright + CDP** | Windows | WebView2にCDP接続。`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`で有効化 |
| **Playwright screenshots** | 全プラットフォーム | ターミナル描画のビジュアルリグレッション |

### ターミナルUI固有のテスト考慮

- xterm.jsは`<canvas>`にレンダリングするため、DOM要素のクエリは不可
- `page.evaluate()`経由でTerminalインスタンスAPIにアクセスしバッファ内容を検証
- スクリーンショット比較 (`toHaveScreenshot()`) でビジュアル検証
- PTYモック: トレイト抽象化 + `mockall`クレートで実プロセスなしのユニットテスト

### CIでの実行

```yaml
# GitHub Actions matrix
strategy:
  matrix:
    os: [ubuntu-latest, windows-latest]
```

- **Linux**: `xvfb-run`で仮想ディスプレイを提供し、`webkit2gtk-driver`をインストール
- **Windows**: Edge WebView2はrunnerにプリインストール済み。`msedgedriver.exe`をPATHに追加

---

## 5. ツール管理: mise

**mise** (旧rtx) をプロジェクト全体のツールバージョン管理に使用する。Node.js、Rust、pnpmを単一の設定ファイルで管理。

```toml
# .mise.toml
[tools]
node = "22"
pnpm = "9"
rust = "stable"

[env]
TAURI_DEBUG = "1"
```

---

## 6. パッケージ管理・依存管理

### フロントエンド: pnpm

- content-addressable storeで最大70%のディスク節約
- strict依存宣言 (宣言されていないパッケージの暗黙利用を防止)
- Tauri公式サポート (`corepack enable`で有効化)

### Rust: Cargo Workspace

- `[workspace.dependencies]`でワークスペース全体の依存バージョンを一元管理
- `Cargo.lock`をコミットしてバージョン整合性を保証
- `cargo-binstall`でCI上のツールインストールを高速化 (ソースからのビルド不要)

---

## 7. タスクランナー: just

**just** をRust/フロントエンド共通のタスクランナーとして使用する。言語非依存、シンプルな構文。

```just
# Justfile

# 開発
dev:
    pnpm tauri dev

# Lint (全体)
lint: lint-rust lint-frontend

lint-rust:
    cargo clippy --workspace --all-targets -- -D warnings
    cargo fmt -- --check
    cargo deny check
    cargo machete

lint-frontend:
    pnpm eslint .
    pnpm prettier --check "src/**/*.{ts,tsx}"
    pnpm tsc --noEmit

# テスト (全体)
test: test-rust test-frontend

test-rust:
    cargo nextest run --workspace

test-frontend:
    pnpm vitest run

# カバレッジ
coverage:
    cargo llvm-cov nextest --workspace --lcov --output-path lcov.info
    pnpm vitest run --coverage

# ビルド
build:
    pnpm tauri build
```

---

## 8. Git Hooks: Lefthook

**lefthook** でpre-commit/pre-pushフックを管理。Go製バイナリで言語非依存、並列実行対応。

```yaml
# lefthook.yml
pre-commit:
  parallel: true
  commands:
    rust-fmt:
      glob: "*.rs"
      run: cargo fmt -- --check
    rust-clippy:
      glob: "*.rs"
      run: cargo clippy --workspace --all-targets -- -D warnings
    rust-machete:
      run: cargo machete
    frontend-lint:
      glob: "*.{ts,tsx,js,jsx}"
      run: pnpm eslint {staged_files}
    frontend-fmt:
      glob: "*.{ts,tsx,js,jsx,json,css}"
      run: pnpm prettier --check {staged_files}
    frontend-typecheck:
      glob: "*.{ts,tsx}"
      run: pnpm tsc --noEmit

pre-push:
  commands:
    rust-test:
      run: cargo nextest run --workspace
    frontend-test:
      run: pnpm vitest run
```

---

## 9. CI/CD: GitHub Actions

### パイプライン構成

```
PR作成/更新 → lint → test → build (matrix: ubuntu, windows)
タグpush → build → release (tauri-action)
```

### 主要Actions

| Action | 用途 |
|---|---|
| `dtolnay/rust-toolchain@stable` | Rustツールチェーンインストール |
| `swatinem/rust-cache@v2` | Cargoビルドキャッシュ |
| `tauri-apps/tauri-action@v0` | Tauriアプリのビルド・リリース |
| `taiki-e/install-action` | cargo-nextest等のバイナリツール高速インストール |

### CI Workflow概要

```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: dtolnay/rust-toolchain@stable
        with: { components: "rustfmt, clippy" }
      - run: cargo fmt --check
      - run: cargo clippy --workspace --all-targets -- -D warnings
      - run: cargo deny check
      - run: pnpm eslint .
      - run: pnpm prettier --check "src/**/*.{ts,tsx}"
      - run: pnpm tsc --noEmit

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: dtolnay/rust-toolchain@stable
      - uses: taiki-e/install-action@cargo-nextest
      - uses: taiki-e/install-action@cargo-llvm-cov
      - run: cargo nextest run --workspace
      - run: cargo llvm-cov nextest --workspace --lcov --output-path lcov.info
      - run: pnpm vitest run --coverage

  build:
    strategy:
      matrix:
        platform: [ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: dtolnay/rust-toolchain@stable
      - uses: swatinem/rust-cache@v2
      - uses: tauri-apps/tauri-action@v0

  e2e:
    needs: build
    strategy:
      matrix:
        platform: [ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.platform }}
    steps:
      # tauri-driver + WebdriverIO or Playwright
```

---

## 10. ツール一覧サマリー

### 全ツール一覧

| カテゴリ | ツール | 役割 |
|---|---|---|
| **ツール管理** | mise | Node.js/Rust/pnpmバージョン管理 |
| **パッケージ管理** | pnpm | フロントエンド依存管理 |
| **パッケージ管理** | Cargo (workspace) | Rust依存管理 |
| **ビルド** | Vite 7 | フロントエンドバンドル |
| **ビルド** | Cargo | Rustコンパイル |
| **タスクランナー** | just | 統合タスク実行 |
| **Rust Lint** | clippy (pedantic) | Rustコード品質 |
| **Rust Format** | rustfmt (2024 edition) | Rustコード整形 |
| **Rust 静的解析** | cargo-deny | 脆弱性・ライセンス・重複依存 |
| **Rust 静的解析** | cargo-machete | 未使用依存検出 (高速) |
| **Rust テスト** | cargo-nextest | テストランナー |
| **Rust テスト** | rstest | パラメータ化テスト |
| **Rust テスト** | proptest | プロパティベーステスト |
| **Rust カバレッジ** | cargo-llvm-cov | コードカバレッジ |
| **TS Lint** | ESLint 9 + typescript-eslint v8 | TypeScript/Reactコード品質 |
| **TS Format** | Prettier | コード整形 |
| **TS 型チェック** | tsc --noEmit | 静的型検証 |
| **TS テスト** | Vitest + React Testing Library | ユニットテスト |
| **E2E テスト** | Playwright | ブラウザ自動化テスト |
| **E2E テスト** | tauri-driver + WebdriverIO | Tauriアプリ E2E |
| **Git Hooks** | Lefthook | pre-commit/pre-push自動化 |
| **CI/CD** | GitHub Actions | 自動ビルド・テスト・リリース |
