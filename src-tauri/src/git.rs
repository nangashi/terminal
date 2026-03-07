use serde::Serialize;
use std::path::Path;

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
    let repo = git2::Repository::discover(path).ok()?;

    let branch = match repo.head() {
        Ok(head) => head.shorthand().unwrap_or("HEAD").to_string(),
        Err(_) => "HEAD".to_string(),
    };

    let repo_name = repo
        .workdir()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    let is_dirty = repo
        .statuses(Some(
            git2::StatusOptions::new()
                .include_untracked(true)
                .recurse_untracked_dirs(false),
        ))
        .map(|s| !s.is_empty())
        .unwrap_or(false);

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
