default:
    @just --list

# Development
dev:
    TMPDIR=/tmp pnpm tauri dev

# Lint & Format checks
lint: lint-rust lint-frontend lint-secrets

lint-rust:
    cargo fmt --check --manifest-path src-tauri/Cargo.toml
    cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
    cd src-tauri && cargo deny check

# Claude Code sandbox sets TMPDIR=/tmp/claude which doesn't exist.
# Override TMPDIR for pnpm commands to use a writable temp directory.
lint-frontend:
    TMPDIR=/tmp pnpm tsc --noEmit
    TMPDIR=/tmp pnpm biome check src/
    TMPDIR=/tmp pnpm oxlint src/

lint-secrets:
    gitleaks detect --no-banner

# Format
fmt:
    cargo fmt --manifest-path src-tauri/Cargo.toml
    TMPDIR=/tmp pnpm biome check --write src/

# Tests
test: test-rust test-frontend

test-rust:
    cd src-tauri && cargo nextest run --workspace

test-frontend:
    TMPDIR=/tmp pnpm vitest run

# Build
build:
    TMPDIR=/tmp pnpm tauri build
