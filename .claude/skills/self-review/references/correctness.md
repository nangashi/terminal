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

### Stale Closures (React specific)
- Callbacks passed to imperative APIs (xterm.js onData, onResize) capturing stale state
- useEffect dependencies missing variables that the effect actually reads
- Event handlers registered once but referencing values that change

### Concurrency (Rust specific)
- Mutex lock held across await points
- Potential deadlocks from multiple lock acquisitions
- Shared mutable state without proper synchronization
