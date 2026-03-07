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

fn git_output(path: &Path, args: &[&str]) -> Option<Vec<u8>> {
    Command::new("git")
        .args(args)
        .current_dir(path)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| o.stdout)
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
}
