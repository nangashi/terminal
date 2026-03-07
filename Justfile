default:
    @just --list

# Development
dev:
    pnpm tauri dev

# Lint & Format checks
lint: lint-rust lint-frontend

lint-rust:
    cargo fmt --check --manifest-path src-tauri/Cargo.toml
    cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
    cd src-tauri && cargo deny check

lint-frontend:
    pnpm tsc --noEmit
    pnpm eslint .
    pnpm prettier --check "src/**/*.{ts,tsx}"

# Format
fmt:
    cargo fmt --manifest-path src-tauri/Cargo.toml
    pnpm prettier --write "src/**/*.{ts,tsx}"

# Tests
test: test-rust test-frontend

test-rust:
    cd src-tauri && cargo nextest run --workspace

test-frontend:
    pnpm vitest run

# Build
build:
    pnpm tauri build
