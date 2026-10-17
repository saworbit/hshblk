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

/// A watch as a look found it: its window, and a copy of what the window's state held, so the
/// file is looked at after the lock goes (#327).
struct Look {
    label: String,
    channel: Channel<String>,
    stamp: Stamp,
    gone: bool,
}

/// Each window's watch, copied under the lock and no longer.
fn watches(states: &WindowStates) -> Vec<Look> {
    let mut looks = Vec::new();
    states.each(|label, state| {
        if let Some(watched) = &state.watched {
            looks.push(Look {
                label: label.to_owned(),
                channel: watched.channel.clone(),
                stamp: watched.stamp,
                gone: watched.gone,
            });
        }
    });
    looks
}

/// Keeps what a look found, if its window still watches down the channel the look copied, and
/// says whether it did. A page that watched again meanwhile started from the text it read then,
/// and a window that closed meanwhile is not made again.
fn keep(states: &WindowStates, look: &Look, stamp: Stamp, gone: bool) -> bool {
    states
        .existing(&look.label, |state| match state.watched.as_mut() {
            Some(watched) if watched.channel.id() == look.channel.id() => {
                watched.stamp = stamp;
                watched.gone = gone;
                true
            }
            _ => false,
        })
        .unwrap_or(false)
}

/// Looks at each watched file once, reads again those that changed, and tells their windows.
/// One whose stamp is unsure is read again too, and its window told only if its text differs.
pub fn look(app: &AppHandle) {
    let documents = app.state::<Documents>();
    let states = app.state::<WindowStates>();
    let now = SystemTime::now();
    // The lock is held only to copy each watch and to keep what a look found. A file on a share
    // that stops answering holds up this thread alone, not Find, Print, or a link (#327).
    for look in watches(&states) {
        let Some(handle) = windows::handle_of(&look.label) else {
            continue;
        };
        let Some(document) = documents.get(handle) else {
            continue;
        };
        let name = &document.name;
        // The text before, for a file that only has to be made sure of.
        let before = match seen(look.stamp, look.gone, Stamp::of(&document.path)) {
            Seen::Same if !look.gone && unsure(look.stamp, now) => Some(document.clone()),
            Seen::Same => continue,
            Seen::Gone => {
                if keep(&states, &look, look.stamp, true) {
                    say(&look.channel, format!("{name} was moved or deleted."));
                }
                continue;
            }
            Seen::Changed(stamp) if keep(&states, &look, stamp, false) => None,
            Seen::Changed(_) => continue,
        };
        match (documents.reload(handle), before) {
            (Some(Ok(now)), Some(before))
                if now.text == before.text && now.facts == before.facts => {}
            (Some(Ok(_)), _) => say(&look.channel, CHANGED.to_owned()),
            // A file that only had to be made sure of is looked at again; nothing is said yet.
            (Some(Err(error)), Some(_)) => {
                eprintln!("A file could not be read again: {}", error.message(name));
            }
            (Some(Err(error)), None) => say(&look.channel, error.message(name)),
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
    fn keeps_a_look_only_for_the_watch_it_copied() {
        // #327: a look reads each file after the lock goes, and its window may watch again, or
        // close, before the look keeps what it found.
        let states = WindowStates::default();
        let stamp = |len| Stamp {
            len,
            modified: None,
        };
        let channel = || Channel::<String>::new(|_| Ok(()));
        for label in ["doc-1", "doc-2", "doc-3"] {
            watch(&states, label, channel(), stamp(1));
        }
        let looks = watches(&states);
        assert_eq!(looks.len(), 3);
        // doc-2's page watches again, from the text it has just read, and doc-3 closes.
        watch(&states, "doc-2", channel(), stamp(5));
        states.forget("doc-3");
        let mut kept: Vec<_> = looks
            .iter()
            .map(|look| (look.label.as_str(), keep(&states, look, stamp(9), false)))
            .collect();
        kept.sort();
        assert_eq!(kept, [("doc-1", true), ("doc-2", false), ("doc-3", false)]);
        let stamp_of =
            |label| states.existing(label, |state| state.watched.as_ref().unwrap().stamp);
        assert_eq!(stamp_of("doc-1"), Some(stamp(9)));
        assert_eq!(stamp_of("doc-2"), Some(stamp(5)));
        // A window that closed gets no state back.
        assert_eq!(states.existing("doc-3", |_| ()), None);
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
