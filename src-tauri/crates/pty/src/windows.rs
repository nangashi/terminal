use crate::{ChildWaiter, PtyError, PtySize};
use std::io::{self, Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use windows_sys::Win32::Foundation::{
    CloseHandle, DuplicateHandle, GetLastError, DUPLICATE_SAME_ACCESS, HANDLE,
    INVALID_HANDLE_VALUE, S_OK, WAIT_OBJECT_0,
};
use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
use windows_sys::Win32::System::Console::{
    ClosePseudoConsole, CreatePseudoConsole, ResizePseudoConsole, COORD, HPCON,
};

// Undocumented ConPTY flags not exposed by windows-sys.
// Values from wezterm/Windows Terminal source.
const PSEUDOCONSOLE_RESIZE_QUIRK: u32 = 0x2;
const PSEUDOCONSOLE_WIN32_INPUT_MODE: u32 = 0x4;
use windows_sys::Win32::System::Threading::{
    CreateProcessW, DeleteProcThreadAttributeList, GetCurrentProcess,
    InitializeProcThreadAttributeList, TerminateProcess, UpdateProcThreadAttribute,
    WaitForSingleObject, EXTENDED_STARTUPINFO_PRESENT, INFINITE, PROCESS_INFORMATION,
    PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, STARTUPINFOEXW,
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const CREATE_UNICODE_ENVIRONMENT: u32 = 0x0000_0400;

/// A Windows pseudo-terminal backed by ConPTY.
///
/// - `spawn` creates pipes, a `PseudoConsole`, and launches the process
///   via `CreateProcessW` with `CREATE_NO_WINDOW`.
/// - Drop order matters: output pipe must close before the console handle
///   to avoid a deadlock in `ClosePseudoConsole` (RFC 1857 / microsoft/terminal#17688).
pub struct Pty {
    // Drop order: output_read first, then hpc — critical for deadlock avoidance.
    output_read: HANDLE,
    input_write: HANDLE,
    hpc: HPCON,
    process_handle: HANDLE,
    child_pid: u32,
    reader_taken: AtomicBool,
    writer_taken: AtomicBool,
}

// HANDLE values are thread-safe (kernel objects).
unsafe impl Send for Pty {}
unsafe impl Sync for Pty {}

impl Pty {
    /// Open a ConPTY, spawn `cmd` inside it, and return the `Pty` handle.
    ///
    /// The caller provides program, args, envs, and cwd through the parameters
    /// of `std::process::Command`, which are read via `.get_program()` /
    /// `.get_args()` / `.get_envs()` / `.get_current_dir()`.
    ///
    /// # Errors
    ///
    /// Returns `PtyError::Open` if pipe/ConPTY creation fails,
    /// `PtyError::Spawn` if `CreateProcessW` fails,
    /// `PtyError::Hresult` if `CreatePseudoConsole` returns a failure HRESULT.
    pub fn spawn(cmd: &mut std::process::Command, size: PtySize) -> Result<Self, PtyError> {
        unsafe {
            // Create pipes for ConPTY I/O
            let mut input_read: HANDLE = INVALID_HANDLE_VALUE;
            let mut input_write: HANDLE = INVALID_HANDLE_VALUE;
            let mut output_read: HANDLE = INVALID_HANDLE_VALUE;
            let mut output_write: HANDLE = INVALID_HANDLE_VALUE;

            let mut sa = std::mem::zeroed::<SECURITY_ATTRIBUTES>();
            sa.nLength = std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32;

            if windows_sys::Win32::System::Pipes::CreatePipe(
                &mut input_read,
                &mut input_write,
                &sa,
                0,
            ) == 0
            {
                return Err(PtyError::Open(io::Error::last_os_error()));
            }

            if windows_sys::Win32::System::Pipes::CreatePipe(
                &mut output_read,
                &mut output_write,
                &sa,
                0,
            ) == 0
            {
                CloseHandle(input_read);
                CloseHandle(input_write);
                return Err(PtyError::Open(io::Error::last_os_error()));
            }

            // Create the pseudo console
            let coord = COORD {
                X: size.cols as i16,
                Y: size.rows as i16,
            };
            let flags = PSEUDOCONSOLE_RESIZE_QUIRK | PSEUDOCONSOLE_WIN32_INPUT_MODE;
            let mut hpc: HPCON = 0;
            let hr = CreatePseudoConsole(coord, input_read, output_write, flags, &mut hpc);
            if hr != S_OK {
                CloseHandle(input_read);
                CloseHandle(input_write);
                CloseHandle(output_read);
                CloseHandle(output_write);
                return Err(PtyError::Hresult(hr));
            }

            // We no longer need these ends — ConPTY owns them now.
            CloseHandle(input_read);
            CloseHandle(output_write);

            // Build the proc thread attribute list
            let mut attr_size: usize = 0;
            InitializeProcThreadAttributeList(std::ptr::null_mut(), 1, 0, &mut attr_size);
            let attr_buf = vec![0u8; attr_size];
            let attr_list = attr_buf.as_ptr() as *mut _;
            if InitializeProcThreadAttributeList(attr_list, 1, 0, &mut attr_size) == 0 {
                ClosePseudoConsole(hpc);
                CloseHandle(input_write);
                CloseHandle(output_read);
                return Err(PtyError::Spawn(io::Error::last_os_error()));
            }

            if UpdateProcThreadAttribute(
                attr_list,
                0,
                PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE as usize,
                hpc as *const _,
                std::mem::size_of::<HPCON>(),
                std::ptr::null_mut(),
                std::ptr::null(),
            ) == 0
            {
                DeleteProcThreadAttributeList(attr_list);
                ClosePseudoConsole(hpc);
                CloseHandle(input_write);
                CloseHandle(output_read);
                return Err(PtyError::Spawn(io::Error::last_os_error()));
            }

            // Build command line as wide string
            let cmdline = build_cmdline(cmd);
            let mut cmdline_wide: Vec<u16> =
                cmdline.encode_utf16().chain(std::iter::once(0)).collect();

            // Build environment block
            let env_block = build_env_block(cmd);

            // Build CWD
            let cwd_wide: Option<Vec<u16>> = cmd.get_current_dir().map(|p| {
                p.to_string_lossy()
                    .encode_utf16()
                    .chain(std::iter::once(0))
                    .collect()
            });

            // Set up STARTUPINFOEXW
            let mut si: STARTUPINFOEXW = std::mem::zeroed();
            si.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
            si.lpAttributeList = attr_list;

            let mut pi: PROCESS_INFORMATION = std::mem::zeroed();

            let creation_flags =
                EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW;

            let result = CreateProcessW(
                std::ptr::null(),
                cmdline_wide.as_mut_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                0, // bInheritHandles = FALSE
                creation_flags,
                env_block
                    .as_ref()
                    .map_or(std::ptr::null(), |b| b.as_ptr().cast()),
                cwd_wide.as_ref().map_or(std::ptr::null(), |c| c.as_ptr()),
                &si.StartupInfo,
                &mut pi,
            );

            DeleteProcThreadAttributeList(attr_list);

            if result == 0 {
                ClosePseudoConsole(hpc);
                CloseHandle(input_write);
                CloseHandle(output_read);
                return Err(PtyError::Spawn(io::Error::last_os_error()));
            }

            // Close the thread handle — we only need the process handle.
            CloseHandle(pi.hThread);

            Ok(Self {
                output_read,
                input_write,
                hpc,
                process_handle: pi.hProcess,
                child_pid: pi.dwProcessId,
                reader_taken: AtomicBool::new(false),
                writer_taken: AtomicBool::new(false),
            })
        }
    }

    /// Return the child process PID.
    #[must_use]
    pub fn child_pid(&self) -> u32 {
        self.child_pid
    }

    /// Resize the pseudo console.
    ///
    /// # Errors
    ///
    /// Returns `PtyError::Hresult` if `ResizePseudoConsole` fails.
    pub fn resize(&self, size: PtySize) -> Result<(), PtyError> {
        let coord = COORD {
            X: size.cols as i16,
            Y: size.rows as i16,
        };
        let hr = unsafe { ResizePseudoConsole(self.hpc, coord) };
        if hr != S_OK {
            return Err(PtyError::Hresult(hr));
        }
        Ok(())
    }

    /// Take the reader end (output pipe).  Can only be called once.
    ///
    /// # Errors
    ///
    /// Returns `PtyError::ReaderAlreadyTaken` on a second call.
    pub fn take_reader(&self) -> Result<Box<dyn Read + Send>, PtyError> {
        if self.reader_taken.swap(true, Ordering::AcqRel) {
            return Err(PtyError::ReaderAlreadyTaken);
        }
        let handle = dup_handle(self.output_read)?;
        Ok(Box::new(PipeReader { handle }))
    }

    /// Take the writer end (input pipe).  Can only be called once.
    ///
    /// # Errors
    ///
    /// Returns `PtyError::WriterAlreadyTaken` on a second call.
    pub fn take_writer(&self) -> Result<Box<dyn Write + Send>, PtyError> {
        if self.writer_taken.swap(true, Ordering::AcqRel) {
            return Err(PtyError::WriterAlreadyTaken);
        }
        let handle = dup_handle(self.input_write)?;
        Ok(Box::new(PipeWriter { handle }))
    }

    /// Create a `ChildWaiter` that blocks until the child exits.
    ///
    /// # Errors
    ///
    /// Returns `PtyError::Io` if handle duplication fails.
    pub fn child_waiter(&self) -> Result<ChildWaiter, PtyError> {
        let handle = dup_handle(self.process_handle)?;
        Ok(ChildWaiter {
            process_handle: handle,
        })
    }
}

impl Drop for Pty {
    fn drop(&mut self) {
        unsafe {
            // Order matters: close the output pipe first so ClosePseudoConsole
            // can drain without deadlocking.
            CloseHandle(self.output_read);
            ClosePseudoConsole(self.hpc);
            CloseHandle(self.input_write);
            // Terminate the child if still alive, then close the handle.
            // Use WaitForSingleObject(timeout=0) instead of GetExitCodeProcess
            // because STILL_ACTIVE (259) is also a valid exit code — MSDN
            // explicitly warns against using it for liveness checks.
            if WaitForSingleObject(self.process_handle, 0) != WAIT_OBJECT_0 {
                TerminateProcess(self.process_handle, 1);
            }
            CloseHandle(self.process_handle);
        }
    }
}

// ---------------------------------------------------------------------------
// Public helper for ChildWaiter
// ---------------------------------------------------------------------------

pub(crate) fn wait_process_handle(handle: HANDLE) -> io::Result<()> {
    let ret = unsafe { WaitForSingleObject(handle, INFINITE) };
    unsafe { CloseHandle(handle) };
    if ret != WAIT_OBJECT_0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Handle helpers
// ---------------------------------------------------------------------------

fn dup_handle(handle: HANDLE) -> Result<HANDLE, PtyError> {
    let mut new_handle: HANDLE = INVALID_HANDLE_VALUE;
    let ok = unsafe {
        DuplicateHandle(
            GetCurrentProcess(),
            handle,
            GetCurrentProcess(),
            &mut new_handle,
            0,
            0,
            DUPLICATE_SAME_ACCESS,
        )
    };
    if ok == 0 {
        return Err(PtyError::Io(io::Error::last_os_error()));
    }
    Ok(new_handle)
}

// ---------------------------------------------------------------------------
// Command-line building
// ---------------------------------------------------------------------------

/// Build a Windows command-line string from a `Command`'s program + args.
fn build_cmdline(cmd: &std::process::Command) -> String {
    let mut parts = Vec::new();
    parts.push(quote_arg(&cmd.get_program().to_string_lossy()));
    for arg in cmd.get_args() {
        parts.push(quote_arg(&arg.to_string_lossy()));
    }
    parts.join(" ")
}

/// Quote a single argument for the Windows command line.
/// See: <https://docs.microsoft.com/en-us/cpp/c-language/parsing-c-command-line-arguments>
fn quote_arg(s: &str) -> String {
    if s.is_empty() {
        return "\"\"".to_string();
    }
    if !s.contains(|c: char| c == ' ' || c == '\t' || c == '"') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    let mut backslashes: usize = 0;
    for c in s.chars() {
        if c == '\\' {
            backslashes += 1;
        } else if c == '"' {
            // Double the backslashes before a quote, then escape the quote.
            for _ in 0..backslashes {
                out.push('\\');
            }
            backslashes = 0;
            out.push('\\');
            out.push('"');
        } else {
            backslashes = 0;
            out.push(c);
        }
    }
    // Double trailing backslashes before the closing quote.
    for _ in 0..backslashes {
        out.push('\\');
    }
    out.push('"');
    out
}

/// Build a null-terminated environment block (UTF-16) from the command's envs.
/// Returns `None` to inherit the parent environment if no envs are set.
fn build_env_block(cmd: &std::process::Command) -> Option<Vec<u16>> {
    let envs: Vec<_> = cmd.get_envs().collect();
    if envs.is_empty() {
        return None;
    }

    // Start with inherited environment, then apply overrides.
    let mut env_map: std::collections::BTreeMap<String, String> = std::env::vars().collect();
    for (key, val) in envs {
        let key_str = key.to_string_lossy().to_string();
        match val {
            Some(v) => {
                env_map.insert(key_str, v.to_string_lossy().to_string());
            }
            None => {
                env_map.remove(&key_str);
            }
        }
    }

    let mut block: Vec<u16> = Vec::new();
    for (k, v) in &env_map {
        let entry = format!("{k}={v}");
        block.extend(entry.encode_utf16());
        block.push(0);
    }
    block.push(0); // double-null terminator
    Some(block)
}

// ---------------------------------------------------------------------------
// Pipe Reader / Writer wrappers
// ---------------------------------------------------------------------------

struct PipeReader {
    handle: HANDLE,
}

unsafe impl Send for PipeReader {}

impl Read for PipeReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let mut bytes_read: u32 = 0;
        let ok = unsafe {
            windows_sys::Win32::Storage::FileSystem::ReadFile(
                self.handle,
                buf.as_mut_ptr(),
                buf.len() as u32,
                &mut bytes_read,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            let err = unsafe { GetLastError() };
            const ERROR_BROKEN_PIPE: u32 = 109;
            if err == ERROR_BROKEN_PIPE {
                return Ok(0); // EOF
            }
            return Err(io::Error::from_raw_os_error(err as i32));
        }
        Ok(bytes_read as usize)
    }
}

impl Drop for PipeReader {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.handle) };
    }
}

struct PipeWriter {
    handle: HANDLE,
}

unsafe impl Send for PipeWriter {}

impl Write for PipeWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let mut bytes_written: u32 = 0;
        let ok = unsafe {
            windows_sys::Win32::Storage::FileSystem::WriteFile(
                self.handle,
                buf.as_ptr(),
                buf.len() as u32,
                &mut bytes_written,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(bytes_written as usize)
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Drop for PipeWriter {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.handle) };
    }
}
