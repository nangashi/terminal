use crate::{ChildWaiter, PtyError, PtySize};
use std::io::{self, Read, Write};
use std::os::unix::io::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::os::unix::process::CommandExt;
use std::sync::atomic::{AtomicBool, Ordering};

/// A Unix pseudo-terminal backed by `openpty(3)` + `std::process::Command`.
///
/// - `spawn` opens a master/slave pair, configures the child (setsid,
///   TIOCSCTTY, close leaked fds), and spawns the command.
/// - `take_reader` / `take_writer` hand out cloned master-fd handles.
/// - Dropping `Pty` closes the master fd, which sends SIGHUP to the child.
pub struct Pty {
    master_fd: OwnedFd,
    child_pid: u32,
    reader_taken: AtomicBool,
    writer_taken: AtomicBool,
    child: std::sync::Mutex<Option<std::process::Child>>,
}

impl Pty {
    /// Open a PTY pair, spawn `cmd` inside the slave side, and return the
    /// `Pty` handle that owns the master side.
    ///
    /// The caller builds a `std::process::Command` (program, args, envs, cwd)
    /// and this function takes care of all PTY plumbing.
    ///
    /// # Errors
    ///
    /// Returns `PtyError::Open` if `openpty` fails, or `PtyError::Spawn` if
    /// the child process cannot be started.
    pub fn spawn(cmd: &mut std::process::Command, size: PtySize) -> Result<Self, PtyError> {
        // Open master/slave pair via libc::openpty
        let (master_fd, slave_fd) = open_pty_pair(size)?;

        // Wire slave fd into the child's stdio
        let slave_stdin = dup_as_stdio(&slave_fd)?;
        let slave_stdout = dup_as_stdio(&slave_fd)?;
        let slave_stderr = dup_as_stdio(&slave_fd)?;

        unsafe {
            cmd.stdin(slave_stdin)
                .stdout(slave_stdout)
                .stderr(slave_stderr)
                .pre_exec(|| {
                    // Reset signal dispositions to default
                    for &sig in &[
                        libc::SIGCHLD,
                        libc::SIGHUP,
                        libc::SIGINT,
                        libc::SIGQUIT,
                        libc::SIGTERM,
                        libc::SIGALRM,
                    ] {
                        libc::signal(sig, libc::SIG_DFL);
                    }

                    // Become session leader
                    if libc::setsid() == -1 {
                        return Err(io::Error::last_os_error());
                    }

                    // Set the slave as controlling terminal
                    #[allow(clippy::cast_lossless)]
                    if libc::ioctl(0, libc::TIOCSCTTY as _, 0) == -1 {
                        return Err(io::Error::last_os_error());
                    }

                    // Close leaked file descriptors (fd > 2)
                    close_random_fds();

                    Ok(())
                });
        }

        let mut child = cmd.spawn().map_err(PtyError::Spawn)?;
        let child_pid = child.id();

        // Drop the child's copy of slave stdio handles so the slave fd
        // doesn't remain open in the parent process.
        child.stdin.take();
        child.stdout.take();
        child.stderr.take();

        // slave_fd is dropped here — only the master side remains open.
        drop(slave_fd);

        Ok(Self {
            master_fd,
            child_pid,
            reader_taken: AtomicBool::new(false),
            writer_taken: AtomicBool::new(false),
            child: std::sync::Mutex::new(Some(child)),
        })
    }

    /// Return the child process PID.
    #[must_use]
    pub fn child_pid(&self) -> u32 {
        self.child_pid
    }

    /// Resize the PTY to the given dimensions.
    ///
    /// # Errors
    ///
    /// Returns `PtyError::Resize` if the ioctl fails.
    pub fn resize(&self, size: PtySize) -> Result<(), PtyError> {
        let ws = libc::winsize {
            ws_row: size.rows,
            ws_col: size.cols,
            ws_xpixel: 0,
            ws_ypixel: 0,
        };
        let ret = unsafe {
            libc::ioctl(
                self.master_fd.as_raw_fd(),
                libc::TIOCSWINSZ as _,
                &ws as *const _,
            )
        };
        if ret != 0 {
            return Err(PtyError::Resize(io::Error::last_os_error()));
        }
        Ok(())
    }

    /// Take the reader end (cloned master fd).  Can only be called once.
    ///
    /// The returned reader converts `EIO` to `EOF`, which is the normal
    /// signal that the slave side has been closed.
    ///
    /// # Errors
    ///
    /// Returns `PtyError::ReaderAlreadyTaken` on a second call.
    pub fn take_reader(&self) -> Result<Box<dyn Read + Send>, PtyError> {
        if self.reader_taken.swap(true, Ordering::AcqRel) {
            return Err(PtyError::ReaderAlreadyTaken);
        }
        let fd = clone_fd(&self.master_fd)?;
        Ok(Box::new(PtyReader { fd }))
    }

    /// Take the writer end (cloned master fd).  Can only be called once.
    ///
    /// On drop, the writer sends a newline + VEOF sequence so that the
    /// child receives a clean EOF on its stdin.
    ///
    /// # Errors
    ///
    /// Returns `PtyError::WriterAlreadyTaken` on a second call.
    pub fn take_writer(&self) -> Result<Box<dyn Write + Send>, PtyError> {
        if self.writer_taken.swap(true, Ordering::AcqRel) {
            return Err(PtyError::WriterAlreadyTaken);
        }
        let fd = clone_fd(&self.master_fd)?;
        Ok(Box::new(PtyWriter { fd }))
    }

    /// Create a `ChildWaiter` that can block until the child exits.
    /// Moves the `Child` handle out of the `Pty`, so can only be called once.
    ///
    /// # Errors
    ///
    /// Returns `PtyError::Io` if the child has already been taken.
    pub fn child_waiter(&self) -> Result<ChildWaiter, PtyError> {
        let child = self
            .child
            .lock()
            .map_err(|_| PtyError::Io(io::Error::other("lock poisoned")))?
            .take()
            .ok_or_else(|| PtyError::Io(io::Error::other("child already taken")))?;
        Ok(ChildWaiter { child })
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Call `libc::openpty` and return `(master, slave)` as `OwnedFd`.
fn open_pty_pair(size: PtySize) -> Result<(OwnedFd, OwnedFd), PtyError> {
    let mut master_raw: RawFd = -1;
    let mut slave_raw: RawFd = -1;
    let mut ws = libc::winsize {
        ws_row: size.rows,
        ws_col: size.cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };

    let ret = unsafe {
        libc::openpty(
            &mut master_raw,
            &mut slave_raw,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut ws,
        )
    };
    if ret != 0 {
        return Err(PtyError::Open(io::Error::last_os_error()));
    }

    let master = unsafe { OwnedFd::from_raw_fd(master_raw) };
    let slave = unsafe { OwnedFd::from_raw_fd(slave_raw) };

    // Set close-on-exec on both fds
    cloexec(master.as_raw_fd()).map_err(PtyError::Open)?;
    cloexec(slave.as_raw_fd()).map_err(PtyError::Open)?;

    Ok((master, slave))
}

/// Set `FD_CLOEXEC` on `fd`.
fn cloexec(fd: RawFd) -> io::Result<()> {
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
    if flags == -1 {
        return Err(io::Error::last_os_error());
    }
    if unsafe { libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC) } == -1 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// Duplicate `fd` into a new `OwnedFd`.
fn clone_fd(fd: &OwnedFd) -> io::Result<OwnedFd> {
    let raw = unsafe { libc::dup(fd.as_raw_fd()) };
    if raw == -1 {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { OwnedFd::from_raw_fd(raw) })
}

/// Duplicate `fd` into a `Stdio` suitable for `Command::stdin` etc.
fn dup_as_stdio(fd: &OwnedFd) -> Result<std::process::Stdio, PtyError> {
    let duped = clone_fd(fd).map_err(PtyError::Open)?;
    Ok(std::process::Stdio::from(duped))
}

/// Close file descriptors > 2 that do NOT have `FD_CLOEXEC` set.
///
/// This prevents leaked descriptors from the parent (e.g., macOS Cocoa,
/// GNOME/mutter) from being inherited by the child process. Fds with
/// `FD_CLOEXEC` (including our PTY fds and `Command`'s internal error
/// pipe) are left alone — `exec` will close them automatically.
fn close_random_fds() {
    if let Ok(dir) = std::fs::read_dir("/dev/fd") {
        let mut fds = Vec::new();
        for entry in dir.flatten() {
            if let Some(num) = entry
                .file_name()
                .into_string()
                .ok()
                .and_then(|n| n.parse::<libc::c_int>().ok())
            {
                if num > 2 {
                    fds.push(num);
                }
            }
        }
        for fd in fds {
            unsafe {
                // Skip fds that already have CLOEXEC — they'll be closed by exec.
                let flags = libc::fcntl(fd, libc::F_GETFD);
                if flags != -1 && (flags & libc::FD_CLOEXEC) != 0 {
                    continue;
                }
                libc::close(fd);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Reader — converts EIO to EOF
// ---------------------------------------------------------------------------

struct PtyReader {
    fd: OwnedFd,
}

impl Read for PtyReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let fd = self.fd.as_raw_fd();
        let n = unsafe { libc::read(fd, buf.as_mut_ptr().cast(), buf.len()) };
        if n < 0 {
            let err = io::Error::last_os_error();
            if err.raw_os_error() == Some(libc::EIO) {
                // Slave side closed — this is normal EOF.
                return Ok(0);
            }
            return Err(err);
        }
        Ok(n as usize)
    }
}

// ---------------------------------------------------------------------------
// Writer — sends EOT on drop
// ---------------------------------------------------------------------------

struct PtyWriter {
    fd: OwnedFd,
}

impl Write for PtyWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let fd = self.fd.as_raw_fd();
        let n = unsafe { libc::write(fd, buf.as_ptr().cast(), buf.len()) };
        if n < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(n as usize)
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Drop for PtyWriter {
    fn drop(&mut self) {
        // Send newline + VEOF so the child gets a clean EOF on stdin.
        let mut termios: libc::termios = unsafe { std::mem::zeroed() };
        if unsafe { libc::tcgetattr(self.fd.as_raw_fd(), &mut termios) } == 0 {
            let eot = termios.c_cc[libc::VEOF];
            if eot != 0 {
                let _ = self.write_all(&[b'\n', eot]);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn spawn_and_read() {
        let mut cmd = std::process::Command::new("/bin/sh");
        let pty = Pty::spawn(&mut cmd, PtySize { rows: 24, cols: 80 }).unwrap();
        assert!(pty.child_pid() > 0);

        let mut writer = pty.take_writer().unwrap();
        let mut reader = pty.take_reader().unwrap();

        writer.write_all(b"echo PTY_TEST_OUTPUT\n").unwrap();

        let mut buf = [0u8; 4096];
        let mut found = false;
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]);
                    if text.contains("PTY_TEST_OUTPUT") {
                        found = true;
                        break;
                    }
                }
                Err(ref e) if e.kind() == io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
        assert!(found, "Expected PTY_TEST_OUTPUT in output");
    }

    #[test]
    fn resize_succeeds() {
        let mut cmd = std::process::Command::new("/bin/sh");
        let pty = Pty::spawn(&mut cmd, PtySize { rows: 24, cols: 80 }).unwrap();
        pty.resize(PtySize {
            rows: 40,
            cols: 120,
        })
        .unwrap();
    }

    #[test]
    fn reader_taken_twice_errors() {
        let mut cmd = std::process::Command::new("/bin/sh");
        let pty = Pty::spawn(&mut cmd, PtySize { rows: 24, cols: 80 }).unwrap();
        let _r1 = pty.take_reader().unwrap();
        assert!(matches!(
            pty.take_reader(),
            Err(PtyError::ReaderAlreadyTaken)
        ));
    }

    #[test]
    fn writer_taken_twice_errors() {
        let mut cmd = std::process::Command::new("/bin/sh");
        let pty = Pty::spawn(&mut cmd, PtySize { rows: 24, cols: 80 }).unwrap();
        let _w1 = pty.take_writer().unwrap();
        assert!(matches!(
            pty.take_writer(),
            Err(PtyError::WriterAlreadyTaken)
        ));
    }

    #[test]
    fn child_waiter_detects_exit() {
        let mut cmd = std::process::Command::new("/bin/sh");
        cmd.arg("-c").arg("exit 0");
        let pty = Pty::spawn(&mut cmd, PtySize { rows: 24, cols: 80 }).unwrap();
        let waiter = pty.child_waiter().unwrap();
        waiter.wait().unwrap();
    }

    #[test]
    fn spawn_invalid_command_errors() {
        let mut cmd = std::process::Command::new("/nonexistent/binary");
        let result = Pty::spawn(&mut cmd, PtySize { rows: 24, cols: 80 });
        assert!(result.is_err());
    }
}
