# レイヤー境界設計

## 目的

このドキュメントはプロジェクトのレイヤー構造と依存方向を定義する。
コード追加・変更時の設計判断基準、およびAIによる実装時の制約として機能する。

---

## レイヤー定義

### Backend (Rust)

| レイヤー | ディレクトリ | 責務 |
|---|---|---|
| Domain | `src-tauri/src/pty/`, `src-tauri/src/git.rs` | ビジネスロジック。PTY管理・外部プロセスとの対話 |
| Commands | `src-tauri/src/commands/` | IPC境界アダプタ。Tauri ↔ Domain の型変換とルーティング |
| Entry | `src-tauri/src/{main,lib}.rs` | アプリ起動、プラグイン/State登録 |

### Frontend (TypeScript/React)

| レイヤー | ディレクトリ | 責務 |
|---|---|---|
| Types | `src/types.ts`, `src/constants.ts` | 共有型定義・定数。依存ゼロ |
| Lib | `src/lib/` | 純粋関数。React/Tauriに依存しないロジック |
| Hooks | `src/hooks/` | React hooks。IPC呼び出し、状態管理ロジック |
| Components | `src/components/` | UIレンダリング。データ取得はhooks経由 |
| App | `src/App.tsx` | オーケストレーション。全レイヤーを結合 |

---

## 依存ルール

### 原則

**依存は上位から下位へのみ許可する。下位レイヤーは上位レイヤーを知らない。**

### Backend 依存方向

```
Entry → Commands → Domain
```

- **Domain → Commands**: 禁止。Domain は Tauri に依存しない
- **Domain → Entry**: 禁止
- **Commands → Entry**: 禁止

### Frontend 依存マトリクス

行 が 列 に依存してよいか:

|  | Types | Lib | Hooks | Components | App |
|---|---|---|---|---|---|
| **Types** | - | ✗ | ✗ | ✗ | ✗ |
| **Lib** | ✓ | 同一層✓ | ✗ | ✗ | ✗ |
| **Hooks** | ✓ | ✓ | 同一層✓ | ✗ | ✗ |
| **Components** | ✓ | ✓ | ✓ | 同一層✓ | ✗ |
| **App** | ✓ | ✓ | ✓ | ✓ | - |

同一レイヤー内の import は許可（Components が別の Components を合成する等）。

---

## 禁止 import 一覧

### Backend

| レイヤー | 禁止する依存 | 理由 |
|---|---|---|
| Domain (`pty/`, `git.rs`) | `tauri::` クレート全般（`AppHandle`, `State`, `command` マクロ等） | Domain をフレームワーク非依存に保つ |
| Commands | Domain の `pub` でない内部実装 | カプセル化の維持 |

### Frontend

| レイヤー | 禁止する import | 理由 |
|---|---|---|
| Types (`types.ts`, `constants.ts`) | 他の全モジュール | 依存ゼロを維持。どこからでも安全に import 可能にする |
| Lib (`src/lib/`) | `react`, `react-dom`, `@tauri-apps/api`, `@tauri-apps/plugin-*` | 純粋関数としてテスト容易性・再利用性を確保 |
| Hooks (`src/hooks/`) | `src/components/*`, `src/App` | 上位レイヤーへの逆依存を防ぐ |
| Components (`src/components/`) | `@tauri-apps/api`, `@tauri-apps/plugin-*`, `src/App` | IPC・プラグイン呼び出しは hooks に集約。App への逆依存を防ぐ |

---

## IPC 境界ルール

- **invoke / listen / emit の呼び出し元**: App または Hooks のみ
- **Components は IPC を直接呼ばない**: hooks 経由でデータを取得・操作する
- **Lib は IPC を呼ばない**: 純粋関数のみ

---

## Commands 層の設計指針

Commands 層は「薄いアダプタ」として機能する:

1. **入力変換**: Tauri から受け取った引数を Domain の型に変換
2. **委譲**: Domain 層のメソッドを呼び出す
3. **出力変換**: Domain の戻り値を Tauri のレスポンス型に変換

Commands 層にビジネスロジック（条件分岐の増加、ループ、データ加工）が増えたら Domain 層への抽出を行う。

```rust
// ✅ Commands層: 変換と委譲のみ
#[tauri::command]
fn create_pty(state: State<PtyManager>, cols: u16, rows: u16) -> Result<String, String> {
    state.spawn(cols, rows).map_err(|e| e.to_string())
}

// ❌ Commands層にロジックが漏れている
#[tauri::command]
fn create_pty(state: State<PtyManager>, cols: u16, rows: u16) -> Result<String, String> {
    let shell = if cfg!(target_os = "windows") { "cmd" } else { "bash" };
    // ... シェル判定ロジックは Domain の責務
}
```

---

## Domain 層からの外部通知パターン

Domain がイベント発行等の外部通知を行う場合、Tauri への直接依存を避け、コールバックまたはチャネルで抽象化する:

```rust
// ✅ コールバックで抽象化
impl PtyManager {
    pub fn spawn<F>(&self, cols: u16, rows: u16, on_output: F) -> Result<PtyId>
    where F: Fn(&str) + Send + 'static { /* ... */ }
}

// Entry/Commands 側で Tauri に接続
pty_manager.spawn(cols, rows, move |data| {
    app_handle.emit("pty-output", payload).ok();
});

// ❌ Domain が Tauri に直接依存
impl PtyManager {
    pub fn spawn(&self, app: AppHandle, cols: u16, rows: u16) -> Result<PtyId> {
        // ...
        app.emit("pty-output", ...);  // Domain が Tauri を知っている
    }
}
```

---

## Frontend の IPC 集約パターン

Components が IPC を必要とする場合、専用 hook を作成して間接化する:

```tsx
// ✅ hook で IPC を隠蔽
// src/hooks/usePtyActions.ts
export function usePtyActions() {
  const createPty = useCallback(async (cols: number, rows: number) => {
    return await invoke<string>("create_pty", { cols, rows });
  }, []);
  return { createPty };
}

// src/components/SomeComponent.tsx
function SomeComponent() {
  const { createPty } = usePtyActions();
  // invoke を直接呼ばない
}

// ❌ Components で invoke を直接呼ぶ
// src/components/SomeComponent.tsx
import { invoke } from "@tauri-apps/api/core";
function SomeComponent() {
  const handleClick = () => invoke("create_pty", { cols: 80, rows: 24 });
  // Components が IPC の詳細を知っている
}
```

---

## 新レイヤー・モジュール追加時の手順

1. このドキュメントのレイヤー定義表に行を追加する
2. 依存マトリクスの行と列を追加する
3. 禁止 import 一覧にエントリを追加する
4. 必要に応じて `.claude/rules/layer-boundary.md` を更新する
