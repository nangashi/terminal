# Performance Review (SR-P)

ID prefix: **SR-P**

## Check Items

### xterm.js Rendering
- WebGL context is a limited browser resource (8-16 contexts) — each terminal tab creates one. Verify contexts are released on tab close / terminal disposal
- WebGL addon fallback to canvas renderer: canvas performance degrades significantly with wide terminals (>200 columns). Check layout constraints
- xterm.js is 100% main-thread — multiple tabs receiving simultaneous output can saturate the main thread and cause UI jank

### Flow Control & Backpressure
- xterm.js has a hardcoded write buffer limit of ~50MB. If PTY produces data faster than xterm.js can parse (5-35 MB/s), the buffer grows unbounded
- High-throughput scenarios (`cat` large file, `yes`, build logs) — check whether PTY reading pauses when xterm.js write buffer is high
- Consider `terminal.onWriteParsed()` for flow control signaling between PTY reader and xterm.js writer
- PTY output event batching: each 4096-byte chunk triggers a separate IPC event + `terminal.write()` — consider accumulating output over a short interval before emitting

### Resize Overhead
- `ResizeObserver` callback should debounce/throttle calls to `fitAddon.fit()` — rapid resize events during window drag fire on every frame
- `fit()` triggers `terminal.onResize` → IPC `resize_pty` → kernel SIGWINCH — cascading overhead per frame
- Pane divider drag recalculates all leaf/divider rects (`computeLeafRects`) on every mouse move — verify this is throttled or uses requestAnimationFrame

### Mutex & Lock Contention (Rust)
- `PtyManager` uses `Arc<Mutex<HashMap>>` shared across all PTYs. Every `write_pty` call locks the entire map even for single-PTY operations
- Under high-throughput scenarios (fast typing + output on multiple tabs), this single lock becomes a bottleneck
- Consider whether `RwLock` (reads don't block each other) or per-PTY locks would reduce contention

### Memory
- Terminal scrollback buffer: ~7MB per tab at 1000 lines × 80 columns; doubles with truecolor attributes. With many tabs, memory adds up
- Verify scrollback limits are explicitly set in `Terminal` constructor options, not left at defaults
- Multi-tab resource accounting: each tab = 1 PTY process + 1 reader thread + 1 waiter thread — verify no upper bound or that cleanup is reliable

### Unnecessary Re-renders (React)
- State updates in `App.tsx` (e.g., tabStates) trigger re-renders of the entire component tree — verify heavy subtrees are memoized or use stable references
- Ref map updates (`ptyToPane`, `paneToPty`, `termRefs`) should not trigger re-renders — confirm they use `useRef`, not `useState`
- Callback props passed to `TerminalView` should be stable (useCallback) to avoid unnecessary terminal re-initialization
