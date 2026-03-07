# Security Review (SR-S)

ID prefix: **SR-S**

## Check Items

### Input Validation
- User input passed to shell commands without sanitization
- Untrusted data used in dynamic code execution (eval, innerHTML)
- Path traversal vulnerabilities in file operations

### Tauri-Specific Security
- CSP (Content Security Policy) configuration — should not be `null` or overly permissive
- Tauri capabilities/permissions — only required permissions should be granted
- IPC commands exposed to frontend — verify each is intentionally public
- Plugin permissions — unused plugins should not grant capabilities

### Information Leakage
- Sensitive data (tokens, keys, credentials) in source code or logs
- Error messages exposing internal implementation details to users
- Debug logging left in production code paths

### Dependency Security
- Known vulnerable dependencies (check Cargo.toml, package.json)
- Unused dependencies that increase attack surface
- Dependencies with overly broad permissions
