---
paths:
  - "src-tauri/src/**/*.rs"
---

## エラー型の設計ルール

新しいモジュールや Tauri コマンドを追加する際、エラーは `String` ではなく専用のエラー型で扱う。
既存コードに手を入れる際も、該当箇所の `String` エラーを型付きエラーに移行する機会とする。

### Domain層

- `thiserror` でモジュール単位のエラー enum を定義する
- 各バリアントにはエラーの種別（NotFound / Io / SpawnFailed 等）を表現する
- 内部エラーは `#[from]` や `#[source]` で原因チェーンを保持する

### Commands層（IPC境界）

- Domain のエラー型を `impl Into<InvokeError>` または `Serialize` 可能な形式に変換する
- フロントエンドがエラー種別を判別できる情報を維持する

### 禁止パターン

```rust
// ❌ 新規コードでの String エラー
fn some_operation() -> Result<(), String> {
    something().map_err(|e| e.to_string())
}
```

設計原則の詳細は `docs/design-principles.md` P3 を参照。
