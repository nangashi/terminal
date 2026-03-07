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

/// Retrieve git repository info for the given directory path.
/// Returns `None` if the path is not inside a git repository.
#[must_use]
pub fn get_info(path: &Path) -> Option<GitInfo> {
    let toplevel = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(path)
        .output()
        .ok()
        .filter(|o| o.status.success())?;

    let toplevel_str = String::from_utf8_lossy(&toplevel.stdout);
    let repo_name = Path::new(toplevel_str.trim())
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    let branch = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(path)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map_or_else(
            || "HEAD".to_string(),
            |o| String::from_utf8_lossy(&o.stdout).trim().to_string(),
        );

    let is_dirty = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(path)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .is_some_and(|o| !o.stdout.is_empty());

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
