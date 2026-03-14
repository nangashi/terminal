# Security Review (SR-S)

ID prefix: **SR-S**

## Check Items

### IPC Command Validation
- All `#[tauri::command]` parameters must be validated on the Rust side — the frontend is untrusted (XSS could invoke any allowed command with arbitrary arguments)
- `cwd` parameter in `create_pty` must reject path traversal (`..`) and access to sensitive directories
- `write_pty` accepts arbitrary data — verify no unintended shell-level injection if data is echoed back through the terminal
- Verify `id` parameters reference only PTYs owned by the calling session

### Tauri Capabilities & Permissions
- Capability JSON files must use the minimum required permissions — no wildcard or overly broad bundles
- `windows` field in capabilities should target specific window labels, not `*`
- Scope restrictions on filesystem/shell commands should include explicit `deny` rules for dangerous paths
- Plugin permissions — unused plugins should not grant capabilities
- Check for `dangerousRemoteDomainIpcAccess` or `remote` capability configuration — should not exist unless explicitly needed

### Event Emission Scoping
- `app.emit()` broadcasts to ALL webviews — use `emit_to()` for targeted emission if multiple windows/webviews exist
- Event payloads (e.g., `pty-output`) must not leak sensitive data (environment variables, file paths) beyond the intended recipient
- Verify frontend event listeners cannot be registered by injected scripts in non-main contexts

### Content Security Policy (CSP)
- `tauri.conf.json` should have a restrictive CSP configured — `null` disables all protection
- Check for inline scripts/styles or remote CDN references that would require weakening the CSP
- Tauri injects nonces at compile time — verify the build pipeline does not strip them

### Clipboard Security
- Right-click paste writes clipboard content directly to PTY — malicious clipboard can contain escape sequences (e.g., `\x1b` sequences that auto-execute in some shells)
- Clipboard read must only occur on user-initiated actions (contextmenu handler) — not programmatically triggered
- Verify clipboard permissions are scoped via Tauri capability, not globally available

### Information Leakage
- Sensitive data (tokens, keys, credentials) in source code or logs
- Error messages exposing internal implementation details to users (e.g., full file paths, Rust panic backtraces)
- Debug logging left in production code paths

### Dependency Security
- Known vulnerable dependencies (check Cargo.toml, package.json)
- Unused dependencies that increase attack surface
- Dependencies with overly broad permissions
