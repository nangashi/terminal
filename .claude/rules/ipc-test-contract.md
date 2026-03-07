---
paths:
  - "src-tauri/src/commands/**/*.rs"
  - "src/App.tsx"
  - "src/constants.ts"
---

## IPC境界のテスト必須ルール

Tauriコマンド (`#[tauri::command]`) またはイベント (`emit`) を追加・変更した場合、
対応するテストを必ず追加・更新する。

- Rust側: PtyManagerのテスト (`src-tauri/src/pty/mod.rs` の `#[cfg(test)]`)
- フロントエンド側: IPC統合テスト (`src/App.ipc.test.tsx`) で mockIPC 経由の検証

テストなしのIPC変更はサイレントな互換性破壊の原因になる。
