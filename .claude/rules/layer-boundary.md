---
paths:
  - "src/**/*.{ts,tsx}"
  - "src-tauri/src/**/*.rs"
---

## レイヤー境界の遵守

コード追加・変更時は依存方向に従う。依存は上位→下位のみ。詳細・コード例は `docs/layer-boundary.md` を参照。

### Backend

- **Domain** (`src-tauri/src/pty/`, `src-tauri/src/git.rs`): `tauri::` への依存禁止。外部通知はコールバック/チャネルで抽象化する
- **Commands** (`src-tauri/src/commands/`): 薄いアダプタ。ビジネスロジック禁止、Domain への委譲のみ

### Frontend

- **Types** (`src/types.ts`, `src/constants.ts`): 他モジュールへの依存禁止
- **Lib** (`src/lib/`): `react`, `@tauri-apps/api` の import 禁止。純粋関数のみ
- **Hooks** (`src/hooks/`): Components, App への依存禁止
- **Components** (`src/components/`): `@tauri-apps/api`, `@tauri-apps/plugin-*` の直接使用禁止（hooks経由）、App への依存禁止
- **App** (`src/App.tsx`): 全レイヤーに依存可

### IPC呼び出し元の制限

`invoke` / `listen` / `emit` を使えるのは App と Hooks のみ。Components と Lib は禁止。
