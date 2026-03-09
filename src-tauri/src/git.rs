use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub repo_name: String,
    pub branch: String,
    pub is_dirty: bool,
}

/// On Windows, apply CREATE_NO_WINDOW to prevent the default terminal
/// (Windows Terminal) from intercepting console creation and flashing
/// a visible window every time a subprocess is spawned.
#[cfg(target_os = "windows")]
fn apply_no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}

#[cfg(not(target_os = "windows"))]
fn apply_no_window(_cmd: &mut Command) {}

fn git_output(path: &Path, args: &[&str]) -> Option<Vec<u8>> {
    let output = if cfg!(target_os = "windows") && path.to_str().is_some_and(|p| p.starts_with('/'))
    {
        // WSL path — run git via wsl using -C to set the working directory.
        let path_str = path.to_str()?;
        let mut cmd = Command::new("wsl");
        cmd.args(["--", "git", "-C", path_str]);
        cmd.args(args);
        apply_no_window(&mut cmd);
        cmd.output().ok()?
    } else {
        let mut cmd = Command::new("git");
        cmd.args(args);
        cmd.current_dir(path);
        apply_no_window(&mut cmd);
        cmd.output().ok()?
    };
    output.status.success().then_some(output.stdout)
}

fn git_stdout(path: &Path, args: &[&str]) -> Option<String> {
    let out = git_output(path, args)?;
    Some(String::from_utf8_lossy(&out).trim().to_string())
}

/// Retrieve git repository info for the given directory path.
/// Returns `None` if the path is not inside a git repository.
#[must_use]
pub fn get_info(path: &Path) -> Option<GitInfo> {
    // Combine both rev-parse queries into a single subprocess
    let rev_parse = git_stdout(
        path,
        &["rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"],
    )?;
    let mut lines = rev_parse.lines();

    let repo_name = lines
        .next()
        .and_then(|l| Path::new(l).file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    let branch = lines.next().unwrap_or("HEAD").to_string();

    let is_dirty = git_output(path, &["status", "--porcelain"]).is_some_and(|o| !o.is_empty());

    Some(GitInfo {
        repo_name,
        branch,
        is_dirty,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn detects_current_repo() {
        // This test runs inside the terminal repo itself
        let cwd = env::current_dir().expect("Failed to get cwd");
        let info = get_info(&cwd);
        assert!(info.is_some(), "Should detect git repo in project dir");
        let info = info.unwrap();
        assert_eq!(info.repo_name, "terminal");
        assert!(!info.branch.is_empty());
    }

    #[test]
    fn returns_none_for_non_repo() {
        let info = get_info(Path::new("/tmp"));
        assert!(info.is_none());
    }

    fn create_temp_git_repo(name: &str) -> std::path::PathBuf {
        // Use target/tmp/ within the project so tests work under restrictive sandboxes
        let mut base = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        base.push("target");
        base.push("tmp");
        let dir = base.join(format!("terminal-test-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("Failed to create temp dir");
        Command::new("git")
            .args(["init"])
            .current_dir(&dir)
            .output()
            .expect("git init failed");
        dir
    }

    fn git_commit(dir: &Path, msg: &str) {
        Command::new("git")
            .args([
                "-c",
                "user.name=test",
                "-c",
                "user.email=test@test",
                "commit",
                "--allow-empty",
                "-m",
                msg,
            ])
            .current_dir(dir)
            .output()
            .expect("git commit failed");
    }

    #[test]
    fn detects_dirty_state() {
        let dir = create_temp_git_repo("dirty");
        git_commit(&dir, "initial");
        fs::write(dir.join("dirty.txt"), "change").expect("Failed to write file");

        let info = get_info(&dir).expect("Should detect git repo");
        assert!(info.is_dirty, "Repo with untracked file should be dirty");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn detects_clean_state() {
        let dir = create_temp_git_repo("clean");
        git_commit(&dir, "initial");

        let info = get_info(&dir).expect("Should detect git repo");
        assert!(!info.is_dirty, "Repo with no changes should be clean");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn detects_branch_after_commit() {
        let dir = create_temp_git_repo("branch");
        git_commit(&dir, "initial");

        let info = get_info(&dir).expect("Should detect git repo");
        // After a commit, branch should be a real name (main/master), not "HEAD"
        assert_ne!(info.branch, "HEAD", "Branch should not be detached HEAD");
        assert!(!info.branch.is_empty(), "Branch name should not be empty");

        let _ = fs::remove_dir_all(&dir);
    }
}
