//! #199: a window shows its file's new text when the file changes on disk.
//!
//! Twice a second Rust looks at each watched document's file: its size and when it was last
//! modified, which a save changes, and no read. When they change, it reads the file again behind
//! the same handle and tells the window, down the channel the page gave `watch_document`. The page
//! asks for the text again. A file that goes, or that no longer opens, is said once.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use crate::documents::{Documents, Stamp};
use crate::windows;

/// How often the open files are looked at.
pub const EVERY: Duration = Duration::from_millis(500);

/// What the page is told when the file has new text. Anything else is a sentence for the status
/// line, saying why the page still shows the text it has.
pub const CHANGED: &str = "changed";

/// A watched window: its line to the page, the file's stamp last acted on, and whether the file
/// was last seen gone, so each change and each going is said once.
struct Watched {
    channel: Channel<String>,
    stamp: Stamp,
    gone: bool,
}

/// Each document window that watches its file, by label.
#[derive(Default)]
pub struct Watchers(Mutex<HashMap<String, Watched>>);

impl Watchers {
    /// Starts watching for a window, from the stamp its document was read with.
    pub fn watch(&self, label: &str, channel: Channel<String>, stamp: Stamp) {
        let watched = Watched {
            channel,
            stamp,
            gone: false,
        };
        let mut watchers = self.0.lock().expect("watchers lock");
        watchers.insert(label.to_owned(), watched);
    }

    /// A closed window's watch goes with it.
    pub fn forget(&self, label: &str) {
        self.0.lock().expect("watchers lock").remove(label);
    }
}

/// What a look at a file finds.
#[derive(Debug, PartialEq, Eq)]
enum Seen {
    Same,
    Changed(Stamp),
    Gone,
}

/// What a look finds, from the stamp last acted on, whether the file was gone then, and its
/// stamp now. A file gone is said once, and one that comes back is read again.
fn seen(last: Stamp, gone: bool, now: Option<Stamp>) -> Seen {
    match now {
        None if gone => Seen::Same,
        None => Seen::Gone,
        Some(now) if now == last && !gone => Seen::Same,
        Some(now) => Seen::Changed(now),
    }
}

/// Looks at each watched file once, reads again those that changed, and tells their windows.
pub fn look(app: &AppHandle) {
    let documents = app.state::<Documents>();
    let watchers = app.state::<Watchers>();
    // The files are read after the lock goes, so a new window's watch never waits on a read.
    let mut changed = Vec::new();
    {
        let mut watchers = watchers.0.lock().expect("watchers lock");
        for (label, watched) in watchers.iter_mut() {
            let Some(document) = windows::handle_of(label).and_then(|handle| documents.get(handle))
            else {
                continue;
            };
            match seen(watched.stamp, watched.gone, Stamp::of(&document.path)) {
                Seen::Same => {}
                Seen::Gone => {
                    watched.gone = true;
                    say(
                        &watched.channel,
                        format!("{} was moved or deleted.", document.name),
                    );
                }
                Seen::Changed(stamp) => {
                    watched.stamp = stamp;
                    watched.gone = false;
                    changed.push((
                        label.clone(),
                        watched.channel.clone(),
                        document.name.clone(),
                    ));
                }
            }
        }
    }
    for (label, channel, name) in changed {
        let Some(handle) = windows::handle_of(&label) else {
            continue;
        };
        match documents.reload(handle) {
            Some(Ok(_)) => say(&channel, CHANGED.to_owned()),
            Some(Err(error)) => say(&channel, error.message(&name)),
            None => {}
        }
    }
}

fn say(channel: &Channel<String>, message: String) {
    if let Err(error) = channel.send(message) {
        eprintln!("A window could not be told its file changed: {error}");
    }
}

/// Looks at the open files for as long as the app runs.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(EVERY);
        look(&app);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::SystemTime;

    #[test]
    fn says_a_change_once_a_going_once_and_a_return_as_a_change() {
        let at = |len| Stamp {
            len,
            modified: Some(SystemTime::UNIX_EPOCH + Duration::from_secs(len)),
        };
        assert_eq!(seen(at(1), false, Some(at(1))), Seen::Same);
        assert_eq!(seen(at(1), false, Some(at(2))), Seen::Changed(at(2)));
        assert_eq!(seen(at(1), false, None), Seen::Gone);
        assert_eq!(seen(at(1), true, None), Seen::Same);
        // Back where it was, with the same stamp, it is read again: it may not be the same file.
        assert_eq!(seen(at(1), true, Some(at(1))), Seen::Changed(at(1)));
    }
}
