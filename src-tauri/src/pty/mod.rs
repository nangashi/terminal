use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
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
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    #[allow(dead_code)]
    child: Box<dyn Child + Send>,
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
    ) -> Result<PtyId, String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {e}"))?;

        let mut cmd = CommandBuilder::new(shell);
        let dir = match cwd.filter(|s| !s.is_empty()) {
            Some(d) => d.to_string(),
            None => std::env::var("HOME").unwrap_or_else(|_| "/".to_string()),
        };
        cmd.cwd(&dir);

        // Inject OSC 7 CWD reporting via environment variable (no PTY echo).
        // bash evaluates PROMPT_COMMAND before each prompt.
        // If the user's .bashrc overrides PROMPT_COMMAND, this is lost,
        // but on Linux /proc fallback still works.
        if !shell.ends_with("cmd.exe") {
            cmd.env(
                "PROMPT_COMMAND",
                r#"printf '\033]7;file://%s%s\a' "$(hostname)" "$PWD"${PROMPT_COMMAND:+;$PROMPT_COMMAND}"#,
            );
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn command: {e}"))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take writer: {e}"))?;

        let id = {
            let mut next = self.next_id.lock().map_err(|e| e.to_string())?;
            let id = *next;
            *next += 1;
            id
        };

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone reader: {e}"))?;

        // Insert instance BEFORE spawning reader thread to avoid race condition
        // where the reader thread tries to remove an entry that doesn't exist yet.
        let instance = PtyInstance {
            master: pair.master,
            writer,
            child,
        };

        // Create shared CWD storage for this PTY
        let cwd_slot: SharedCwd = Arc::new(Mutex::new(None));
        self.cwd_map
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id, Arc::clone(&cwd_slot));

        self.instances
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id, instance);

        let instances = Arc::clone(&self.instances);
        let cwd_map = Arc::clone(&self.cwd_map);

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
            if let Ok(mut map) = instances.lock() {
                map.remove(&id);
            }
            if let Ok(mut map) = cwd_map.lock() {
                map.remove(&id);
            }
            on_exit(id);
        });

        Ok(id)
    }

    /// Write data to a PTY.
    ///
    /// # Errors
    ///
    /// Returns an error if the PTY ID is not found or writing fails.
    pub fn write(&self, id: PtyId, data: &[u8]) -> Result<(), String> {
        let mut instances = self.instances.lock().map_err(|e| e.to_string())?;
        let instance = instances
            .get_mut(&id)
            .ok_or_else(|| format!("PTY {id} not found"))?;
        instance
            .writer
            .write_all(data)
            .map_err(|e| format!("Failed to write to PTY: {e}"))
    }

    /// Resize a PTY.
    ///
    /// # Errors
    ///
    /// Returns an error if the PTY ID is not found or resizing fails.
    pub fn resize(&self, id: PtyId, cols: u16, rows: u16) -> Result<(), String> {
        let instances = self.instances.lock().map_err(|e| e.to_string())?;
        let instance = instances
            .get(&id)
            .ok_or_else(|| format!("PTY {id} not found"))?;
        instance
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to resize PTY: {e}"))
    }

    /// Get the child process PID for a PTY.
    ///
    /// # Errors
    ///
    /// Returns an error if the PTY ID is not found or the mutex is poisoned.
    pub fn get_child_pid(&self, id: PtyId) -> Result<Option<u32>, String> {
        let instances = self.instances.lock().map_err(|e| e.to_string())?;
        let instance = instances
            .get(&id)
            .ok_or_else(|| format!("PTY {id} not found"))?;
        Ok(instance.child.process_id())
    }

    /// Get the CWD reported by OSC 7 for a PTY.
    ///
    /// # Errors
    ///
    /// Returns an error if the mutex is poisoned.
    pub fn get_cwd(&self, id: PtyId) -> Result<Option<String>, String> {
        let map = self.cwd_map.lock().map_err(|e| e.to_string())?;
        let Some(slot) = map.get(&id) else {
            return Ok(None);
        };
        let cwd = slot.lock().map_err(|e| e.to_string())?;
        Ok(cwd.clone())
    }

    /// Close and remove a PTY.
    ///
    /// # Errors
    ///
    /// Returns an error if the mutex is poisoned.
    pub fn close(&self, id: PtyId) -> Result<(), String> {
        if let Some(mut instance) = self
            .instances
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&id)
        {
            instance.child.kill().ok();
            instance.child.wait().ok();
        }
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
        assert!(write_result.unwrap_err().contains("not found"));

        let resize_result = manager.resize(9999, 80, 24);
        assert!(resize_result.is_err());
        assert!(resize_result.unwrap_err().contains("not found"));
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
        assert!(result.unwrap_err().contains("not found"));
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
