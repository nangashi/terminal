---
paths:
  - "src/**/*.{ts,tsx}"
  - "src-tauri/src/**/*.rs"
---

## フロントエンド・バックエンド間の文字列契約

イベント名（`pty-output` 等）やコマンド名など、Rust↔TypeScript 間で共有する文字列は必ず定数化する。

- Rust 側: `pub const` で定義
- TypeScript 側: `constants.ts` に定義

ハードコード文字列の重複は typo によるサイレント障害の原因になる（イベントが届かなくても型エラーにならない）。
