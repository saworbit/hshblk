//! #199: a window shows its file's new text when the file changes on disk.
//!
//! Twice a second Rust looks at each watched document's file: its size and when it was last
//! modified, which a save changes, and no read. When they change, it reads the file again behind
//! the same handle and tells the window, down the channel the page gave `watch_document`. The page
//! asks for the text again. A file that goes, or that no longer opens, is said once. A time kept
//! only to the second can hide a save of the same length, so while it is that new the file is
//! read again each look, and the window told only when its text differs (#310).

use std::time::{Duration, SystemTime};

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use crate::documents::{Documents, Stamp};
use crate::window_state::WindowStates;
use crate::windows;

/// How often the open files are looked at.
pub const EVERY: Duration = Duration::from_millis(500);

/// What the page is told when the file has new text. Anything else is a sentence for the status
/// line, saying why the page still shows the text it has.
pub const CHANGED: &str = "changed";

/// A watched window: its line to the page, the file's stamp last acted on, and whether the file
/// was last seen gone, so each change and each going is said once. Its window's state holds it,
/// and it goes with the window (#299).
pub struct Watched {
    channel: Channel<String>,
    stamp: Stamp,
    gone: bool,
}

/// Starts watching for a window, from the stamp its document was read with.
pub fn watch(states: &WindowStates, label: &str, channel: Channel<String>, stamp: Stamp) {
    let watched = Watched {
        channel,
        stamp,
        gone: false,
    };
    states.with(label, |state| state.watched = Some(watched));
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

/// How long a time kept only to the second can hide another save: FAT's two seconds, which it
/// may round up, and a look's time to come round.
const UNSURE: Duration = Duration::from_secs(3);

/// Whether a stamp the same as the last may still hide a save of the same length (#310). FAT
/// keeps a file's time to two seconds and HFS+ to one, so a time on a whole second, as theirs
/// always are, is unsure until it is that far behind the clock. NTFS, APFS, and ext4 keep
/// fractions of a second, so a save there changes the time.
fn unsure(stamp: Stamp, now: SystemTime) -> bool {
    let Some(modified) = stamp.modified else {
        return false;
    };
    let whole = modified
        .duration_since(SystemTime::UNIX_EPOCH)
        .is_ok_and(|since| since.subsec_nanos() == 0);
    whole
        && now
            .duration_since(modified)
            .map_or(true, |age| age < UNSURE)
}

/// Looks at each watched file once, reads again those that changed, and tells their windows.
/// One whose stamp is unsure is read again too, and its window told only if its text differs.
pub fn look(app: &AppHandle) {
    let documents = app.state::<Documents>();
    let now = SystemTime::now();
    // The files are read after the lock goes, so a new window's watch never waits on a read.
    let mut changed = Vec::new();
    app.state::<WindowStates>().each(|label, state| {
        let Some(watched) = state.watched.as_mut() else {
            return;
        };
        let Some(document) = windows::handle_of(label).and_then(|handle| documents.get(handle))
        else {
            return;
        };
        match seen(watched.stamp, watched.gone, Stamp::of(&document.path)) {
            Seen::Same if !watched.gone && unsure(watched.stamp, now) => {
                let name = document.name.clone();
                changed.push((
                    label.to_owned(),
                    watched.channel.clone(),
                    name,
                    Some(document),
                ));
            }
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
                    label.to_owned(),
                    watched.channel.clone(),
                    document.name.clone(),
                    None,
                ));
            }
        }
    });
    for (label, channel, name, unsure) in changed {
        let Some(handle) = windows::handle_of(&label) else {
            continue;
        };
        match (documents.reload(handle), unsure) {
            (Some(Ok(now)), Some(before))
                if now.text == before.text && now.facts == before.facts => {}
            (Some(Ok(_)), _) => say(&channel, CHANGED.to_owned()),
            // A file that only had to be made sure of is looked at again; nothing is said yet.
            (Some(Err(error)), Some(_)) => {
                eprintln!("A file could not be read again: {}", error.message(&name));
            }
            (Some(Err(error)), None) => say(&channel, error.message(&name)),
            (None, _) => {}
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
    use std::fs;
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

    #[test]
    fn is_unsure_of_a_time_kept_to_the_second_until_the_second_has_passed() {
        // #310: FAT keeps a file's time to two seconds, and HFS+ to one, so a second save of
        // the same length in that time leaves the stamp as it was.
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("a.md");
        let second = SystemTime::UNIX_EPOCH + Duration::from_secs(1_800_000_000);
        let save = |text: &str| {
            fs::write(&file, text).unwrap();
            let opened = fs::File::options().write(true).open(&file).unwrap();
            opened.set_modified(second).unwrap();
        };
        save("cat");
        let first = Stamp::of(&file).unwrap();
        save("cot");
        assert_eq!(seen(first, false, Stamp::of(&file)), Seen::Same);
        let after = |millis| second + Duration::from_millis(millis);
        assert!(unsure(first, after(0)));
        assert!(unsure(first, after(2_900)));
        assert!(!unsure(first, after(3_000)));
        // FAT may round a time up, so one ahead of the clock is unsure too.
        assert!(unsure(first, second - Duration::from_millis(1_500)));
        // A time with a fraction of a second came from a file system that keeps one.
        let fine = Stamp {
            modified: Some(second + Duration::from_millis(250)),
            ..first
        };
        assert!(!unsure(fine, after(1_000)));
        assert!(!unsure(
            Stamp {
                modified: None,
                ..first
            },
            after(0)
        ));
    }
}
