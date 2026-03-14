# Maintainability Review (SR-M)

ID prefix: **SR-M**

## Check Items

### Code Duplication
- Identical or near-identical logic repeated across files
- Copy-pasted mock definitions in test files
- Same magic values (strings, numbers, colors) hardcoded in multiple locations

### Coupling
- Components importing types/values from unexpected locations (wrong dependency direction)
- Module-scope side effects (API calls, mutable state) that complicate testing
- Tight coupling between layers that should be independent

### Fragile Internal API Dependencies
- Hardcoded xterm.js internal CSS selectors (`.xterm-helper-textarea`, `.composition-view`) — these are undocumented and may change between versions
- Direct DOM manipulation of xterm.js internals (e.g., IME position locking) — flag as fragile, document the xterm.js version assumption
- Reliance on undocumented behavior of third-party libraries

### Platform-Specific Code Management
- ConPTY (Windows) vs openpty (Unix) behavioral differences not abstracted behind the PTY trait — new PTY features must be tested on both paths
- WSL-specific shell integration (ZDOTDIR trick, PROMPT_COMMAND injection) — changes must consider both native Linux and WSL execution contexts
- `cmd.exe` fallback gracefully degrades when shell integration (OSC 7) is unavailable
- `#[cfg(target_os)]` guards in tests — verify CI runs tests on all supported platforms or documents gaps

### Dead Code
- Unused imports, variables, functions, or types
- Unreachable code branches
- Commented-out code blocks without explanation
- Unused dependencies in package.json or Cargo.toml

### Testability
- Code patterns that make unit testing unnecessarily difficult
- Global mutable state that leaks between tests
- Missing cleanup in test setup/teardown
- xterm.js test mock (`src/test/mocks/xterm.ts`) diverging from the real API surface — mock must be updated when xterm.js is upgraded
