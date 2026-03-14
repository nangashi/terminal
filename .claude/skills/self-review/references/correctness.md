# Correctness Review (SR-C)

ID prefix: **SR-C**

## Check Items

### Logic Bugs
- Off-by-one errors, incorrect boundary conditions
- Incorrect comparison operators or boolean logic
- Missing null/undefined checks where values can actually be absent
- Race conditions between async operations

### Unimplemented / Incomplete Code
- TODO/FIXME comments indicating missing functionality
- Functions that are declared but not fully implemented
- Error paths that silently swallow errors without handling
- Return values from important operations that are discarded

### Resource Leaks
- Event listeners registered but never removed
- Timers (setInterval/setTimeout) not cleared on cleanup
- PTY processes spawned without lifecycle management
- Threads spawned without join or cleanup mechanism
- File handles or streams opened but not closed
- WebGL contexts not released on terminal disposal (browser limit: 8-16)

### useEffect Cleanup Completeness (React specific)
- Terminal, addons (WebGL, Fit, Unicode), ResizeObserver must all be disposed in cleanup
- `document`/`window` level event listeners missed in cleanup (e.g., IME composition, keydown)
- Async operations (clipboard read, IPC calls) that resolve after component unmount — guard against use-after-dispose
- React Strict Mode double-mount: verify terminal survives mount → unmount → remount without duplicate instances or orphaned PTY processes

### Stale Closures (React specific)
- Callbacks passed to imperative APIs (xterm.js onData, onResize, onTitleChange, attachCustomKeyEventHandler) capturing stale state
- useEffect dependencies missing variables that the effect actually reads
- Event handlers registered once but referencing values that change
- New imperative callbacks added without the ref pattern (`xxxRef.current = xxx`)

### Buffer Boundary & Encoding (PTY specific)
- Multi-byte UTF-8 characters split across PTY read boundaries — data path must not assume each chunk is valid UTF-8
- OSC 7 escape sequence spanning two consecutive reads — partial sequence at buffer tail will be missed
- Binary data from xterm.js `onBinary` (e.g., mouse escape sequences) — verify the IPC path supports non-UTF-8 payloads, or that `write_pty(String)` does not silently drop bytes

### Thread Lifecycle (Rust specific)
- Reader thread and waiter thread both attempt to remove the same PTY ID from the instances map — verify the second removal is a no-op (not a panic)
- `close_pty` during active reader output — reader must handle broken pipe / EOF gracefully
- Rapid create/close cycles — verify no resource leak from thread spawn timing

### Concurrency (Rust specific)
- Mutex lock held across await points
- Potential deadlocks from multiple lock acquisitions
- Shared mutable state without proper synchronization
