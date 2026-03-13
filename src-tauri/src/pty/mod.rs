use pty::{Pty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;

pub type PtyId = u32;

/// Callback invoked when PTY output is available.
pub type OutputCallback = Box<dyn Fn(PtyId, Vec<u8>) + Send>;
/// Callback invoked when the shell process exits.
pub type ExitCallback = Box<dyn Fn(PtyId) + Send>;

/// Shared CWD storage updated by OSC 7 parsing in the reader thread.
type SharedCwd = Arc<Mutex<Option<String>>>;

/// Per-PTY CWD storage, keyed by PTY ID.
/// Separate from `PtyInstance` so the reader thread can update it
/// without locking the entire instances map.
type CwdMap = Arc<Mutex<HashMap<PtyId, SharedCwd>>>;

struct PtyInstance {
    pty: Pty,
    writer: Box<dyn Write + Send>,
}

#[derive(Debug, thiserror::Error)]
pub enum PtyManagerError {
    #[error("PTY {0} not found")]
    NotFound(PtyId),
    #[error(transparent)]
    Pty(#[from] pty::PtyError),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("lock poisoned")]
    LockPoisoned,
}

pub struct PtyManager {
    instances: Arc<Mutex<HashMap<PtyId, PtyInstance>>>,
    cwd_map: CwdMap,
    next_id: Arc<Mutex<PtyId>>,
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Extract the path from an OSC 7 sequence in the given byte buffer.
///
/// OSC 7 format: `\x1b]7;file://hostname/path\x07` or `\x1b]7;file://hostname/path\x1b\\`
/// We also accept bare paths: `\x1b]7;/path\x07`
fn extract_osc7_path(buf: &[u8]) -> Option<String> {
    // Find the last OSC 7 sequence (most recent CWD report)
    let needle = b"\x1b]7;";
    let start = buf
        .windows(needle.len())
        .rposition(|w| w == needle)?
        .checked_add(needle.len())?;

    // Find the terminator: BEL (\x07) or ST (\x1b\\)
    let rest = buf.get(start..)?;
    let end = rest
        .iter()
        .position(|&b| b == b'\x07')
        .or_else(|| rest.windows(2).position(|w| w == b"\x1b\\"))?;

    let raw = std::str::from_utf8(rest.get(..end)?).ok()?;

    // Strip file://hostname prefix if present
    if let Some(after_scheme) = raw.strip_prefix("file://") {
        // Skip hostname (everything up to and including the first '/')
        let path_start = after_scheme.find('/')?;
        let path = percent_decode(after_scheme.get(path_start..)?);
        if path.is_empty() {
            None
        } else {
            Some(path)
        }
    } else if raw.starts_with('/') {
        Some(percent_decode(raw))
    } else {
        None
    }
}

/// Decode percent-encoded bytes in a URI path (e.g. `%20` → ` `).
fn percent_decode(input: &str) -> String {
    let mut out = Vec::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(val) = u8::from_str_radix(
                // SAFETY: we just checked i+2 < len
                &input[i + 1..i + 3],
                16,
            ) {
                out.push(val);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Directory for zsh shell integration files (OSC 7 CWD reporting).
const ZSH_INT_DIR: &str = "/tmp/.terminal-osc7";

/// Content for the zsh integration `.zshenv` file.
/// Restores the original `ZDOTDIR`, sources the user's `.zshenv`,
/// and registers an OSC 7 `precmd` hook.
const ZSHENV_OSC7: &str = r#"if [ -n "$_TERMINAL_ORIG_ZDOTDIR" ]; then ZDOTDIR="$_TERMINAL_ORIG_ZDOTDIR"; else unset ZDOTDIR; fi
unset _TERMINAL_ORIG_ZDOTDIR
[ -f "${ZDOTDIR:-$HOME}/.zshenv" ] && . "${ZDOTDIR:-$HOME}/.zshenv"
__terminal_osc7_precmd() { printf '\033]7;file://%s%s\a' "$(hostname)" "$PWD"; }
precmd_functions+=(__terminal_osc7_precmd)
"#;

/// Wrapper script for `wsl.exe -e sh -c '...'` that sets up OSC 7
/// CWD reporting for both bash (`PROMPT_COMMAND`) and zsh (`ZDOTDIR`
/// trick with `precmd` hook) inside WSL, then execs the user's login shell.
const WSL_WRAPPER: &str = r#"_d=/tmp/.terminal-osc7
mkdir -p "$_d" 2>/dev/null
cat > "$_d/.zshenv" << 'ZSHENV'
if [ -n "$_TERMINAL_ORIG_ZDOTDIR" ]; then ZDOTDIR="$_TERMINAL_ORIG_ZDOTDIR"; else unset ZDOTDIR; fi
unset _TERMINAL_ORIG_ZDOTDIR
[ -f "${ZDOTDIR:-$HOME}/.zshenv" ] && . "${ZDOTDIR:-$HOME}/.zshenv"
__terminal_osc7_precmd() { printf '\033]7;file://%s%s\a' "$(hostname)" "$PWD"; }
precmd_functions+=(__terminal_osc7_precmd)
ZSHENV
export _TERMINAL_ORIG_ZDOTDIR="${ZDOTDIR:-}"
export ZDOTDIR="$_d"
export PROMPT_COMMAND='printf '"'"'\033]7;file://%s%s\a'"'"' "$(hostname)" "$PWD"'
exec "$SHELL" -l"#;

/// Returns the default home directory for the current platform.
/// Tries `HOME` first, then `USERPROFILE` (Windows), with a safe fallback.
fn default_home_dir() -> String {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| {
            if cfg!(target_os = "windows") {
                "C:\\".to_string()
            } else {
                "/".to_string()
            }
        })
}

/// Configure `cmd` with OSC 7 CWD reporting and working directory.
///
/// For `wsl.exe`: uses `--cd` to set the working directory inside WSL
/// (defaults to `~` for the Linux user's home) and a wrapper script that
/// sets up both bash and zsh integration, then execs the user's login shell.
///
/// For native shells: sets `PROMPT_COMMAND` (bash) and optionally the
/// `ZDOTDIR` trick (zsh) to inject a `precmd` hook.
fn setup_cwd_and_osc7(cmd: &mut std::process::Command, shell: &str, cwd: Option<&str>) {
    if shell.ends_with("wsl.exe") {
        // On Windows with wsl.exe, use --cd to set the working directory
        // inside the Linux filesystem.  cmd.current_dir() sets the Win32
        // lpCurrentDirectory which cannot represent Linux paths.
        // Default to "~" (WSL user's home) when no explicit cwd is given.
        cmd.arg("--cd");
        cmd.arg(cwd.unwrap_or("~"));
        // Wrapper script sets up OSC 7 for both bash (`PROMPT_COMMAND`)
        // and zsh (`ZDOTDIR` + `precmd` hook), then execs the user's login
        // shell.
        cmd.arg("-e");
        cmd.arg("sh");
        cmd.arg("-c");
        cmd.arg(WSL_WRAPPER);
    } else {
        let dir = cwd.map_or_else(default_home_dir, String::from);
        cmd.current_dir(dir);
        // Inject OSC 7 CWD reporting so the terminal can track CWD.
        if !shell.ends_with("cmd.exe") {
            // bash: PROMPT_COMMAND
            cmd.env(
                "PROMPT_COMMAND",
                r#"printf '\033]7;file://%s%s\a' "$(hostname)" "$PWD"${PROMPT_COMMAND:+;$PROMPT_COMMAND}"#,
            );
            // zsh: ZDOTDIR trick — inject a .zshenv that adds a precmd hook.
            if shell.contains("zsh") {
                let _ = std::fs::create_dir_all(ZSH_INT_DIR);
                let _ = std::fs::write(format!("{ZSH_INT_DIR}/.zshenv"), ZSHENV_OSC7);
                if let Ok(orig) = std::env::var("ZDOTDIR") {
                    cmd.env("_TERMINAL_ORIG_ZDOTDIR", orig);
                }
                cmd.env("ZDOTDIR", ZSH_INT_DIR);
            }
        }
    }
}

impl PtyManager {
    #[must_use]
    pub fn new() -> Self {
        Self {
            instances: Arc::new(Mutex::new(HashMap::new())),
            cwd_map: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(Mutex::new(1)),
        }
    }

    /// Spawn a new PTY with the given shell command.
    /// Returns the PTY ID.
    ///
    /// # Errors
    ///
    /// Returns an error if the PTY system fails to open a pair or spawn the command.
    pub fn spawn(
        &self,
        shell: &str,
        cols: u16,
        rows: u16,
        cwd: Option<&str>,
        on_output: OutputCallback,
        on_exit: ExitCallback,
    ) -> Result<PtyId, PtyManagerError> {
        let mut cmd = std::process::Command::new(shell);
        setup_cwd_and_osc7(&mut cmd, shell, cwd.filter(|s| !s.is_empty()));

        let pty = Pty::spawn(&mut cmd, PtySize { rows, cols })?;
        let writer = pty.take_writer()?;

        let id = {
            let mut next = self
                .next_id
                .lock()
                .map_err(|_| PtyManagerError::LockPoisoned)?;
            let id = *next;
            *next += 1;
            id
        };

        let mut reader = pty.take_reader()?;
        let waiter = pty.child_waiter()?;

        // Insert instance BEFORE spawning reader thread to avoid race condition
        // where the reader thread tries to remove an entry that doesn't exist yet.
        let instance = PtyInstance { pty, writer };

        // Create shared CWD storage for this PTY
        let cwd_slot: SharedCwd = Arc::new(Mutex::new(None));
        self.cwd_map
            .lock()
            .map_err(|_| PtyManagerError::LockPoisoned)?
            .insert(id, Arc::clone(&cwd_slot));

        self.instances
            .lock()
            .map_err(|_| PtyManagerError::LockPoisoned)?
            .insert(id, instance);

        let instances_for_reader = Arc::clone(&self.instances);
        let cwd_map_for_reader = Arc::clone(&self.cwd_map);

        // Spawn a thread to read PTY output
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if let Some(path) = extract_osc7_path(&buf[..n]) {
                            if let Ok(mut cwd) = cwd_slot.lock() {
                                *cwd = Some(path);
                            }
                        }
                        on_output(id, buf[..n].to_vec());
                    }
                    Err(e) => {
                        if e.kind() == std::io::ErrorKind::Interrupted {
                            continue;
                        }
                        eprintln!("PTY {id} read error: {e}");
                        break;
                    }
                }
            }
            // Clean up instance and CWD entry, then notify frontend
            if let Ok(mut map) = instances_for_reader.lock() {
                map.remove(&id);
            }
            if let Ok(mut map) = cwd_map_for_reader.lock() {
                map.remove(&id);
            }
            on_exit(id);
        });

        // Spawn a waiter thread to detect when the child process exits.
        // On Windows ConPTY, the reader thread does not receive EOF when the
        // child exits. By waiting on the child and then dropping the master PTY
        // (via removing the instance from the map), we force the reader's pipe
        // to break, which unblocks the reader and triggers on_exit.
        let instances_for_waiter = Arc::clone(&self.instances);
        thread::spawn(move || {
            let _ = waiter.wait();
            if let Ok(mut map) = instances_for_waiter.lock() {
                map.remove(&id);
            }
        });

        Ok(id)
    }

    /// Write data to a PTY.
    ///
    /// # Errors
    ///
    /// Returns an error if the PTY ID is not found or writing fails.
    pub fn write(&self, id: PtyId, data: &[u8]) -> Result<(), PtyManagerError> {
        let mut instances = self
            .instances
            .lock()
            .map_err(|_| PtyManagerError::LockPoisoned)?;
        let instance = instances
            .get_mut(&id)
            .ok_or(PtyManagerError::NotFound(id))?;
        instance.writer.write_all(data)?;
        Ok(())
    }

    /// Resize a PTY.
    ///
    /// # Errors
    ///
    /// Returns an error if the PTY ID is not found or resizing fails.
    pub fn resize(&self, id: PtyId, cols: u16, rows: u16) -> Result<(), PtyManagerError> {
        let instances = self
            .instances
            .lock()
            .map_err(|_| PtyManagerError::LockPoisoned)?;
        let instance = instances.get(&id).ok_or(PtyManagerError::NotFound(id))?;
        instance.pty.resize(PtySize { rows, cols })?;
        Ok(())
    }

    /// Get the child process PID for a PTY.
    ///
    /// # Errors
    ///
    /// Returns an error if the PTY ID is not found or the mutex is poisoned.
    pub fn get_child_pid(&self, id: PtyId) -> Result<Option<u32>, PtyManagerError> {
        let instances = self
            .instances
            .lock()
            .map_err(|_| PtyManagerError::LockPoisoned)?;
        let instance = instances.get(&id).ok_or(PtyManagerError::NotFound(id))?;
        Ok(Some(instance.pty.child_pid()))
    }

    /// Get the CWD reported by OSC 7 for a PTY.
    ///
    /// # Errors
    ///
    /// Returns an error if the mutex is poisoned.
    pub fn get_cwd(&self, id: PtyId) -> Result<Option<String>, PtyManagerError> {
        let map = self
            .cwd_map
            .lock()
            .map_err(|_| PtyManagerError::LockPoisoned)?;
        let Some(slot) = map.get(&id) else {
            return Ok(None);
        };
        let cwd = slot.lock().map_err(|_| PtyManagerError::LockPoisoned)?;
        Ok(cwd.clone())
    }

    /// Close and remove a PTY.
    ///
    /// # Errors
    ///
    /// Returns an error if the mutex is poisoned.
    pub fn close(&self, id: PtyId) -> Result<(), PtyManagerError> {
        // Dropping the PtyInstance closes the master PTY.
        // On Unix this sends SIGHUP to the child process group.
        // On Windows this closes the ConPTY, terminating attached processes.
        // Either way the reader thread will get EOF/error and call on_exit.
        self.instances
            .lock()
            .map_err(|_| PtyManagerError::LockPoisoned)?
            .remove(&id);
        if let Ok(mut map) = self.cwd_map.lock() {
            map.remove(&id);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    fn noop_exit() -> ExitCallback {
        Box::new(|_| {})
    }

    // --- OSC 7 parser tests ---

    #[test]
    fn osc7_with_bel_terminator() {
        let buf = b"\x1b]7;file://myhost/home/user/project\x07";
        assert_eq!(
            extract_osc7_path(buf),
            Some("/home/user/project".to_string())
        );
    }

    #[test]
    fn osc7_with_st_terminator() {
        let buf = b"\x1b]7;file://myhost/tmp/test\x1b\\";
        assert_eq!(extract_osc7_path(buf), Some("/tmp/test".to_string()));
    }

    #[test]
    fn osc7_bare_path() {
        let buf = b"\x1b]7;/home/user\x07";
        assert_eq!(extract_osc7_path(buf), Some("/home/user".to_string()));
    }

    #[test]
    fn osc7_percent_encoded() {
        let buf = b"\x1b]7;file://host/home/user/my%20project\x07";
        assert_eq!(
            extract_osc7_path(buf),
            Some("/home/user/my project".to_string())
        );
    }

    #[test]
    fn osc7_embedded_in_output() {
        let buf = b"some output\x1b]7;file://h/home/user\x07more output";
        assert_eq!(extract_osc7_path(buf), Some("/home/user".to_string()));
    }

    #[test]
    fn osc7_uses_last_occurrence() {
        let buf = b"\x1b]7;file://h/old/path\x07stuff\x1b]7;file://h/new/path\x07";
        assert_eq!(extract_osc7_path(buf), Some("/new/path".to_string()));
    }

    #[test]
    fn osc7_no_sequence_returns_none() {
        let buf = b"just regular output";
        assert_eq!(extract_osc7_path(buf), None);
    }

    #[test]
    fn osc7_empty_path_returns_none() {
        let buf = b"\x1b]7;file://host\x07";
        assert_eq!(extract_osc7_path(buf), None);
    }

    #[test]
    fn spawn_and_read_output() {
        let manager = PtyManager::new();
        let (tx, rx) = mpsc::channel();

        let id = manager
            .spawn(
                "/bin/sh",
                80,
                24,
                None,
                Box::new(move |_id, data| {
                    let _ = tx.send(data);
                }),
                noop_exit(),
            )
            .expect("Failed to spawn PTY");

        assert!(id > 0);

        // Write a command
        manager
            .write(id, b"echo hello_pty_test\n")
            .expect("Failed to write");

        // Read output (with timeout)
        let mut found = false;
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            if let Ok(data) = rx.recv_timeout(Duration::from_millis(100)) {
                let text = String::from_utf8_lossy(&data);
                if text.contains("hello_pty_test") {
                    found = true;
                    break;
                }
            }
        }
        assert!(found, "Expected to find 'hello_pty_test' in PTY output");

        manager.close(id).expect("Failed to close PTY");
    }

    #[test]
    fn resize_does_not_error() {
        let manager = PtyManager::new();
        let id = manager
            .spawn("/bin/sh", 80, 24, None, Box::new(|_, _| {}), noop_exit())
            .expect("Failed to spawn PTY");

        manager.resize(id, 120, 40).expect("Failed to resize");
        manager.close(id).expect("Failed to close PTY");
    }

    #[test]
    fn close_removes_pty() {
        let manager = PtyManager::new();
        let id = manager
            .spawn("/bin/sh", 80, 24, None, Box::new(|_, _| {}), noop_exit())
            .expect("Failed to spawn PTY");

        manager.close(id).expect("Failed to close PTY");

        let result = manager.write(id, b"test");
        assert!(result.is_err());
    }

    #[test]
    fn exit_callback_fires_on_shell_exit() {
        let manager = PtyManager::new();
        let (tx, rx) = mpsc::channel();

        let id = manager
            .spawn(
                "/bin/sh",
                80,
                24,
                None,
                Box::new(|_, _| {}),
                Box::new(move |exit_id| {
                    let _ = tx.send(exit_id);
                }),
            )
            .expect("Failed to spawn PTY");

        // Tell the shell to exit
        manager.write(id, b"exit\n").expect("Failed to write");

        // Wait for exit callback
        let exit_id = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("Exit callback not fired");
        assert_eq!(exit_id, id);
    }

    #[test]
    fn multiple_pty_output_isolation() {
        let manager = PtyManager::new();
        let (tx1, rx1) = mpsc::channel();
        let (tx2, rx2) = mpsc::channel();

        let id1 = manager
            .spawn(
                "/bin/sh",
                80,
                24,
                None,
                Box::new(move |_id, data| {
                    let _ = tx1.send(data);
                }),
                noop_exit(),
            )
            .expect("Failed to spawn PTY 1");

        let id2 = manager
            .spawn(
                "/bin/sh",
                80,
                24,
                None,
                Box::new(move |_id, data| {
                    let _ = tx2.send(data);
                }),
                noop_exit(),
            )
            .expect("Failed to spawn PTY 2");

        // Write MARKER only to PTY 1
        manager
            .write(id1, b"echo MARKER_PTY1\n")
            .expect("Failed to write to PTY 1");

        // Wait for PTY 1 to output MARKER
        let mut found_in_pty1 = false;
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            if let Ok(data) = rx1.recv_timeout(Duration::from_millis(100)) {
                if String::from_utf8_lossy(&data).contains("MARKER_PTY1") {
                    found_in_pty1 = true;
                    break;
                }
            }
        }
        assert!(found_in_pty1, "Expected MARKER_PTY1 in PTY 1 output");

        // Verify PTY 2 did NOT receive MARKER
        let mut found_in_pty2 = false;
        while let Ok(data) = rx2.recv_timeout(Duration::from_millis(500)) {
            if String::from_utf8_lossy(&data).contains("MARKER_PTY1") {
                found_in_pty2 = true;
                break;
            }
        }
        assert!(
            !found_in_pty2,
            "MARKER_PTY1 should NOT appear in PTY 2 output"
        );

        manager.close(id1).expect("Failed to close PTY 1");
        manager.close(id2).expect("Failed to close PTY 2");
    }

    #[test]
    fn nonexistent_id_returns_error() {
        let manager = PtyManager::new();

        let write_result = manager.write(9999, b"test");
        assert!(write_result.is_err());
        assert!(
            matches!(&write_result, Err(PtyManagerError::NotFound(9999))),
            "Expected NotFound, got: {write_result:?}"
        );

        let resize_result = manager.resize(9999, 80, 24);
        assert!(resize_result.is_err());
        assert!(
            matches!(&resize_result, Err(PtyManagerError::NotFound(9999))),
            "Expected NotFound, got: {resize_result:?}"
        );
    }

    #[test]
    fn spawn_invalid_shell_returns_error() {
        let manager = PtyManager::new();
        let result = manager.spawn(
            "/nonexistent/shell",
            80,
            24,
            None,
            Box::new(|_, _| {}),
            noop_exit(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn close_then_resize_returns_error() {
        let manager = PtyManager::new();
        let id = manager
            .spawn("/bin/sh", 80, 24, None, Box::new(|_, _| {}), noop_exit())
            .expect("Failed to spawn PTY");

        manager.close(id).expect("Failed to close PTY");

        let result = manager.resize(id, 120, 40);
        assert!(result.is_err());
        assert!(matches!(&result, Err(PtyManagerError::NotFound(_))));
    }

    #[test]
    fn full_lifecycle() {
        let manager = PtyManager::new();
        let (output_tx, output_rx) = mpsc::channel();
        let (exit_tx, exit_rx) = mpsc::channel();

        // Spawn
        let id = manager
            .spawn(
                "/bin/sh",
                80,
                24,
                None,
                Box::new(move |_id, data| {
                    let _ = output_tx.send(data);
                }),
                Box::new(move |exit_id| {
                    let _ = exit_tx.send(exit_id);
                }),
            )
            .expect("Failed to spawn PTY");
        assert!(id > 0);

        // Write
        manager
            .write(id, b"echo LIFECYCLE_TEST\n")
            .expect("Failed to write");

        // Read output
        let mut found = false;
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            if let Ok(data) = output_rx.recv_timeout(Duration::from_millis(100)) {
                if String::from_utf8_lossy(&data).contains("LIFECYCLE_TEST") {
                    found = true;
                    break;
                }
            }
        }
        assert!(found, "Expected to find 'LIFECYCLE_TEST' in PTY output");

        // Resize
        manager.resize(id, 120, 40).expect("Failed to resize");

        // Exit
        manager.write(id, b"exit\n").expect("Failed to write exit");

        // Wait for exit callback
        let exit_id = exit_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("Exit callback not fired");
        assert_eq!(exit_id, id);
    }
}
