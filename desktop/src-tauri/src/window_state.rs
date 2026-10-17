//! #299: what Rust keeps for each window, by its label, in one map: its page's line from the menu
//! bar (#182), a place a link in another window sends it to (#285), the watch on its file (#199),
//! and the welcome window's line for the recent files (#326). A window that closes takes all of
//! it with one `forget`, so a part added later cannot outlive its window.

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::ipc::Channel;

use crate::watch::Watched;

/// One window's part of each feature.
#[derive(Default)]
pub struct WindowState {
    /// The page's line from the menu bar, for Find and Print on macOS.
    menu: Option<Channel<String>>,
    /// Where a link in another window sends the page, or the page's line for it.
    fragment: Option<Fragment>,
    /// The watch on the window's file, which `watch::look` reads.
    pub watched: Option<Watched>,
    /// The welcome window's line for word that the recent files changed.
    recent: Option<Channel<String>>,
}

/// A new window's page has no channel until it asks, so a fragment sent before then waits. Only
/// the last one waits, which is the place the reader asked for last.
enum Fragment {
    Waiting(String),
    Watched(Channel<String>),
}

/// Each window's state, by label.
#[derive(Default)]
pub struct WindowStates(Mutex<HashMap<String, WindowState>>);

impl WindowStates {
    /// Runs `f` on the window's state, made empty first if it has none.
    pub fn with<R>(&self, label: &str, f: impl FnOnce(&mut WindowState) -> R) -> R {
        let mut states = self.0.lock().expect("window states lock");
        f(states.entry(label.to_owned()).or_default())
    }

    /// Runs `f` on the window's state, if it has one. A window that closed gets none back.
    pub fn existing<R>(&self, label: &str, f: impl FnOnce(&mut WindowState) -> R) -> Option<R> {
        self.0
            .lock()
            .expect("window states lock")
            .get_mut(label)
            .map(f)
    }

    /// Runs `f` on each window's state.
    pub fn each(&self, mut f: impl FnMut(&str, &mut WindowState)) {
        let mut states = self.0.lock().expect("window states lock");
        for (label, state) in states.iter_mut() {
            f(label, state);
        }
    }

    /// A closed window's state goes with it, every part at once.
    pub fn forget(&self, label: &str) {
        self.0.lock().expect("window states lock").remove(label);
    }

    /// Keeps the page's line from the menu bar.
    pub fn watch_menu(&self, label: &str, channel: Channel<String>) {
        self.with(label, |state| state.menu = Some(channel));
    }

    /// Sends a menu bar item to the window's page, if it gave a line for them.
    pub fn menu(&self, label: &str, action: &str) {
        let states = self.0.lock().expect("window states lock");
        if let Some(channel) = states.get(label).and_then(|state| state.menu.as_ref()) {
            if let Err(error) = channel.send(action.to_owned()) {
                eprintln!("The menu could not reach its window: {error}");
            }
        }
    }

    /// Sends the window's page to `fragment`, now if it watches for one, or else once it does.
    pub fn send_fragment(&self, label: &str, fragment: String) {
        self.with(label, |state| {
            if let Some(Fragment::Watched(channel)) = &state.fragment {
                if let Err(error) = channel.send(fragment) {
                    eprintln!("A link could not reach its window: {error}");
                }
                return;
            }
            state.fragment = Some(Fragment::Waiting(fragment));
        });
    }

    /// Keeps the welcome window's line for word that the recent files changed.
    pub fn watch_recent(&self, label: &str, channel: Channel<String>) {
        self.with(label, |state| state.recent = Some(channel));
    }

    /// Tells each window that lists the recent files to list them again, as after Clear Menu.
    pub fn recent_changed(&self) {
        self.each(|_, state| {
            if let Some(channel) = &state.recent {
                if let Err(error) = channel.send("changed".to_owned()) {
                    eprintln!("A window could not be told the recent files changed: {error}");
                }
            }
        });
    }

    /// Keeps the page's line for fragments, and sends down it one that waited.
    pub fn watch_fragments(&self, label: &str, channel: Channel<String>) {
        self.with(label, |state| {
            if let Some(Fragment::Waiting(fragment)) = state.fragment.take() {
                if let Err(error) = channel.send(fragment) {
                    eprintln!("A link could not reach its window: {error}");
                }
            }
            state.fragment = Some(Fragment::Watched(channel));
        });
    }

    /// The labels of the windows with state, in order.
    #[cfg(test)]
    fn labels(&self) -> Vec<String> {
        let mut labels: Vec<_> = self.0.lock().unwrap().keys().cloned().collect();
        labels.sort();
        labels
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    use crate::documents::Stamp;
    use crate::watch;

    /// A channel that keeps what is sent down it, as JSON.
    fn kept() -> (Channel<String>, Arc<Mutex<Vec<String>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let into = seen.clone();
        let channel = Channel::<String>::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                into.lock().unwrap().push(json);
            }
            Ok(())
        });
        (channel, seen)
    }

    #[test]
    fn sends_a_window_where_a_link_named_now_or_once_its_page_watches() {
        // #285: a link to a heading in another file opened that file at its top.
        let (channel, seen) = kept();
        let states = WindowStates::default();
        // A new window's page has not asked yet, so the fragment waits for it.
        states.send_fragment("doc-1", "#install".into());
        states.watch_fragments("doc-1", channel);
        // An open window's page takes it at once.
        states.send_fragment("doc-1", "#usage".into());
        assert_eq!(*seen.lock().unwrap(), [r##""#install""##, r##""#usage""##]);
        // A closed window's line goes with it.
        states.forget("doc-1");
        states.send_fragment("doc-1", "#later".into());
        assert_eq!(seen.lock().unwrap().len(), 2);
    }

    #[test]
    fn tells_each_window_that_lists_the_recent_files_when_they_change() {
        // #326: Clear Menu emptied the recent files, and an open welcome window kept listing them.
        let states = WindowStates::default();
        let (first, told) = kept();
        let (second, also) = kept();
        states.watch_recent("empty-0", first);
        states.watch_recent("empty-1", second);
        let (menu, menu_told) = kept();
        states.watch_menu("doc-1", menu);
        states.recent_changed();
        assert_eq!(*told.lock().unwrap(), [r#""changed""#]);
        assert_eq!(*also.lock().unwrap(), [r#""changed""#]);
        assert!(menu_told.lock().unwrap().is_empty());
        // A welcome window that closed is told nothing more.
        states.forget("empty-0");
        states.recent_changed();
        assert_eq!(told.lock().unwrap().len(), 1);
        assert_eq!(also.lock().unwrap().len(), 2);
    }

    #[test]
    fn forgets_all_that_a_closed_window_kept_at_once() {
        // #299: each part had a registry of its own, and a window's close forgot each by hand.
        let states = WindowStates::default();
        let (menu, said) = kept();
        states.watch_menu("doc-1", menu);
        states.menu("doc-1", "find");
        assert_eq!(*said.lock().unwrap(), [r#""find""#]);
        states.send_fragment("doc-1", "#install".into());
        let stamp = Stamp {
            len: 1,
            modified: None,
        };
        watch::watch(&states, "doc-1", kept().0, stamp);
        states.watch_menu("doc-2", kept().0);
        states.forget("doc-1");
        assert_eq!(states.labels(), ["doc-2"]);
        // A window that is gone is sent nothing, and gets no state back from a send.
        states.menu("doc-1", "print");
        assert_eq!(said.lock().unwrap().len(), 1);
        assert_eq!(states.labels(), ["doc-2"]);
    }
}
