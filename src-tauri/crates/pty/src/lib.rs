#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub use unix::Pty;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::Pty;

/// Terminal dimensions in character cells.
pub struct PtySize {
    pub rows: u16,
    pub cols: u16,
}

/// Lightweight handle for waiting on child process exit without owning the PTY.
/// Used by waiter threads to detect when the shell exits.
pub struct ChildWaiter {
    #[cfg(unix)]
    child: std::process::Child,
    #[cfg(windows)]
    process_handle: windows_sys::Win32::Foundation::HANDLE,
}

impl ChildWaiter {
    /// Block until the child process exits.
    ///
    /// # Errors
    ///
    /// Returns an error if waiting on the child process fails.
    pub fn wait(self) -> std::io::Result<()> {
        #[cfg(unix)]
        {
            let mut child = self.child;
            child.wait()?;
            Ok(())
        }
        #[cfg(windows)]
        {
            self::windows::wait_process_handle(self.process_handle)
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum PtyError {
    #[error("failed to open PTY: {0}")]
    Open(#[source] std::io::Error),
    #[error("failed to spawn process: {0}")]
    Spawn(#[source] std::io::Error),
    #[error("failed to resize PTY: {0}")]
    Resize(#[source] std::io::Error),
    #[error("reader already taken")]
    ReaderAlreadyTaken,
    #[error("writer already taken")]
    WriterAlreadyTaken,
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[cfg(windows)]
    #[error("ConPTY error: HRESULT {0:#010x}")]
    Hresult(i32),
}
