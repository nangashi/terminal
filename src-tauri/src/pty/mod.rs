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

struct PtyInstance {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    #[allow(dead_code)]
    child: Box<dyn Child + Send>,
}

pub struct PtyManager {
    instances: Arc<Mutex<HashMap<PtyId, PtyInstance>>>,
    next_id: Arc<Mutex<PtyId>>,
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}

impl PtyManager {
    #[must_use]
    pub fn new() -> Self {
        Self {
            instances: Arc::new(Mutex::new(HashMap::new())),
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
        cmd.cwd(std::env::var("HOME").unwrap_or_else(|_| "/".to_string()));

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

        let instances = Arc::clone(&self.instances);

        // Spawn a thread to read PTY output
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => on_output(id, buf[..n].to_vec()),
                    Err(e) => {
                        if e.kind() == std::io::ErrorKind::Interrupted {
                            continue;
                        }
                        eprintln!("PTY {id} read error: {e}");
                        break;
                    }
                }
            }
            // Clean up instance and notify frontend
            if let Ok(mut map) = instances.lock() {
                map.remove(&id);
            }
            on_exit(id);
        });

        let instance = PtyInstance {
            master: pair.master,
            writer,
            child,
        };

        self.instances
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id, instance);

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

    /// Close and remove a PTY.
    ///
    /// # Errors
    ///
    /// Returns an error if the mutex is poisoned.
    pub fn close(&self, id: PtyId) -> Result<(), String> {
        self.instances
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&id);
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

    #[test]
    fn spawn_and_read_output() {
        let manager = PtyManager::new();
        let (tx, rx) = mpsc::channel();

        let id = manager
            .spawn(
                "/bin/sh",
                80,
                24,
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
            .spawn("/bin/sh", 80, 24, Box::new(|_, _| {}), noop_exit())
            .expect("Failed to spawn PTY");

        manager.resize(id, 120, 40).expect("Failed to resize");
        manager.close(id).expect("Failed to close PTY");
    }

    #[test]
    fn close_removes_pty() {
        let manager = PtyManager::new();
        let id = manager
            .spawn("/bin/sh", 80, 24, Box::new(|_, _| {}), noop_exit())
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
}
