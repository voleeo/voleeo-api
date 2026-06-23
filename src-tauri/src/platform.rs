use std::io;
use std::path::{Path, PathBuf};

/// Link `link` → `target` (a directory): symlink on Unix, junction on Windows.
pub fn link_dir(target: &Path, link: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link)
    }
    #[cfg(windows)]
    {
        junction::create(target, link)
    }
}

/// Resolve the target of a link created by `link_dir`.
pub fn read_link_target(link: &Path) -> io::Result<PathBuf> {
    #[cfg(unix)]
    {
        std::fs::read_link(link)
    }
    #[cfg(windows)]
    {
        junction::get_target(link)
    }
}

/// Unlink a link created by `link_dir`, without touching its target.
pub fn remove_link(link: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        std::fs::remove_file(link)
    }
    #[cfg(windows)]
    {
        // A junction is a directory reparse point — remove_dir unlinks it
        // without recursing into the target.
        std::fs::remove_dir(link)
    }
}
