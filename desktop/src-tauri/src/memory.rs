//! What the app keeps between runs, in its own data folder and never beside a file (docs/hld.md
//! §5): the size and place of the window the reader last moved or resized (#240), and the files
//! opened last (#242). Paths stay in Rust: the page is told a recent file's name and a token.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// How many recent files the welcome window lists.
pub const RECENT: usize = 8;

/// The file it keeps them in, in the app's data folder.
const FILE: &str = "kept.json";

/// A window's size and its top left corner, in points.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Geometry {
    pub width: f64,
    pub height: f64,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
struct Kept {
    #[serde(default)]
    window: Option<Geometry>,
    #[serde(default)]
    recent: Vec<PathBuf>,
}

/// What the app keeps, and the tokens that name the recent files to the page.
#[derive(Default)]
pub struct Memory {
    file: Option<PathBuf>,
    kept: Mutex<Kept>,
    tokens: Mutex<HashMap<String, PathBuf>>,
    /// Held through a save, so saves take turns at the one file beside `kept.json` (#309).
    saving: Mutex<()>,
}

impl Memory {
    /// What was kept in `folder` last time, or nothing, when there is none or it does not read.
    pub fn load(folder: Option<PathBuf>) -> Self {
        let file = folder.map(|folder| folder.join(FILE));
        let kept = file
            .as_deref()
            .and_then(|file| fs::read(file).ok())
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            file,
            kept: Mutex::new(kept),
            tokens: Mutex::default(),
            saving: Mutex::default(),
        }
    }

    /// The size and place of the window the reader last moved or resized.
    pub fn window(&self) -> Option<Geometry> {
        self.kept.lock().expect("memory lock").window
    }

    /// Keeps a window's size and place, until `save` writes it.
    pub fn moved(&self, geometry: Geometry) {
        self.kept.lock().expect("memory lock").window = Some(geometry);
    }

    /// Puts a file at the top of the recent files, and keeps them.
    pub fn opened(&self, path: &Path) {
        let mut kept = self.kept.lock().expect("memory lock");
        kept.recent = remember(&kept.recent, path);
        drop(kept);
        self.save();
    }

    /// The recent files that are still there, for File > Open Recent on macOS (#288). The
    /// page's tokens stay as they were.
    pub fn files(&self) -> Vec<PathBuf> {
        let recent = self.kept.lock().expect("memory lock").recent.clone();
        recent.into_iter().filter(|path| path.is_file()).collect()
    }

    /// The recent files that are still there, each with a token that names it to the page for
    /// the next `open_recent`. The tokens before them stop naming anything.
    pub fn recent(&self, mut token: impl FnMut() -> String) -> Vec<(String, PathBuf)> {
        let files = self.files();
        let mut tokens = self.tokens.lock().expect("tokens lock");
        tokens.clear();
        files
            .into_iter()
            .map(|path| {
                let named = token();
                tokens.insert(named.clone(), path.clone());
                (named, path)
            })
            .collect()
    }

    /// The recent file a token names, if it names one.
    pub fn take(&self, token: &str) -> Option<PathBuf> {
        self.tokens.lock().expect("tokens lock").get(token).cloned()
    }

    /// Writes what is kept, through a file beside it renamed over it, so a write cut short leaves
    /// the last one whole. A folder that cannot be written keeps nothing, and says so. A save
    /// takes what is kept once it has its turn, so the one that writes last writes the newest.
    pub fn save(&self) {
        let Some(file) = &self.file else {
            return;
        };
        let _turn = self.saving.lock().expect("saving lock");
        let bytes = serde_json::to_vec_pretty(&*self.kept.lock().expect("memory lock"))
            .expect("kept values serialize");
        let written = file
            .parent()
            .map_or(Ok(()), fs::create_dir_all)
            .and_then(|()| fs::write(file.with_extension("tmp"), bytes))
            .and_then(|()| fs::rename(file.with_extension("tmp"), file));
        if let Err(error) = written {
            eprintln!("What the app keeps between runs could not be written: {error}");
        }
    }
}

/// The recent files with `path` at the top, once, and no more than `RECENT`.
fn remember(recent: &[PathBuf], path: &Path) -> Vec<PathBuf> {
    std::iter::once(path.to_path_buf())
        .chain(recent.iter().filter(|kept| kept.as_path() != path).cloned())
        .take(RECENT)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_last_file_opened_first_once_and_no_more_than_eight() {
        let paths: Vec<PathBuf> = (0..10)
            .map(|n| PathBuf::from(format!("/a/{n}.md")))
            .collect();
        let mut recent = Vec::new();
        for path in &paths {
            recent = remember(&recent, path);
        }
        assert_eq!(recent.len(), RECENT);
        assert_eq!(recent[0], paths[9]);
        // Opened again, a file moves to the top and is not listed twice.
        recent = remember(&recent, &paths[5]);
        assert_eq!(recent[0], paths[5]);
        assert_eq!(recent.iter().filter(|path| **path == paths[5]).count(), 1);
    }

    #[test]
    fn lists_the_files_for_the_menu_and_leaves_the_pages_tokens_be() {
        // #288: File > Open Recent lists what the welcome window lists, whose tokens must hold.
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("notes.md");
        fs::write(&file, "x").unwrap();
        let memory = Memory::load(None);
        memory.opened(&folder.path().join("gone.md"));
        memory.opened(&file);
        assert_eq!(memory.recent(|| "t1".to_owned()).len(), 1);
        assert_eq!(memory.files(), std::slice::from_ref(&file));
        assert_eq!(memory.take("t1"), Some(file));
    }

    #[test]
    fn writes_the_newest_files_when_saves_overlap() {
        // #309: two saves shared kept.tmp, so the older could land last, or the two could mix.
        let folder = tempfile::tempdir().unwrap();
        let data = folder.path().join("data");
        let memory = std::sync::Arc::new(Memory::load(Some(data.clone())));
        for round in 0..200 {
            let start = std::sync::Arc::new(std::sync::Barrier::new(2));
            let threads: Vec<_> = (0..2)
                .map(|thread| {
                    let (memory, start) = (memory.clone(), start.clone());
                    std::thread::spawn(move || {
                        start.wait();
                        memory.opened(&PathBuf::from(format!("/a/{round}-{thread}.md")));
                    })
                })
                .collect();
            for thread in threads {
                thread.join().unwrap();
            }
            let kept = memory.kept.lock().unwrap().recent.clone();
            let saved = Memory::load(Some(data.clone())).kept.into_inner().unwrap();
            assert_eq!(saved.recent, kept, "round {round}");
        }
    }

    #[test]
    fn keeps_the_window_and_the_files_between_runs_in_its_own_folder() {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("notes.md");
        fs::write(&file, "x").unwrap();
        let first = Memory::load(Some(folder.path().join("data")));
        assert_eq!(first.window(), None);
        let geometry = Geometry {
            width: 1000.0,
            height: 700.0,
            x: -1400.0,
            y: 40.0,
        };
        first.moved(geometry);
        first.opened(&file);
        first.opened(&folder.path().join("gone.md"));
        first.save();
        let second = Memory::load(Some(folder.path().join("data")));
        assert_eq!(second.window(), Some(geometry));
        // A file that has gone is not listed, and a token names only the listing it came from.
        let mut count = 0;
        let listed = second.recent(|| {
            count += 1;
            format!("t{count}")
        });
        assert_eq!(listed, [("t1".to_owned(), file.clone())]);
        assert_eq!(second.take("t1"), Some(file));
        assert_eq!(second.take("t2"), None);
        // What does not read is as if nothing was kept.
        fs::write(folder.path().join("data").join(FILE), "not json").unwrap();
        assert_eq!(
            Memory::load(Some(folder.path().join("data"))).window(),
            None
        );
    }
}
