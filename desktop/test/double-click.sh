#!/bin/sh
# docs/hld.md §8, item 7, on Linux: a file opens the way a file manager opens it, through the
# installed desktop entry, and a second file opens a second window in the same process.
#
#   test/double-click.sh
#
# Needs the package installed, an X display, a D-Bus session, gio, and xdotool. The entry is
# made the default for markdown in a folder of its own, not in your settings.
set -eu

if pgrep -x hshblk > /dev/null; then
  echo "Hash Block is running. Close it first, so the files are not opened by it." >&2
  exit 1
fi

work=$(mktemp -d)
pid=""
cleanup() {
  if [ -n "$pid" ]; then
    kill "$pid" 2> /dev/null || true
    # Until it is gone, so a run straight after this one does not find it.
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2> /dev/null || break; sleep 0.5; done
  fi
  rm -rf "$work"
}
trap cleanup EXIT

mkdir -p "$work/config" "$work/notes/.git"
printf '# First\n' > "$work/notes/first.md"
printf '# Second\n' > "$work/notes/second.md"
printf '[Default Applications]\ntext/markdown=Hash Block.desktop\n' > "$work/config/mimeapps.list"
export XDG_CONFIG_HOME="$work/config"

window() {
  timeout 60 xdotool search --sync --name "^$1\$" | head -n 1
}

gio open "$work/notes/first.md"
first=$(window 'first\.md')
pid=$(xdotool getwindowpid "$first")

gio open "$work/notes/second.md"
second=$(window 'second\.md')

if [ "$(xdotool getwindowpid "$second")" != "$pid" ]; then
  echo "fail: the second file opened in a process of its own" >&2
  exit 1
fi
# The second launch handed its file over. It should now be gone.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ "$(pgrep -c -x hshblk)" -eq 1 ] && break
  sleep 0.5
done
if [ "$(pgrep -c -x hshblk)" -ne 1 ]; then
  echo "fail: the second launch did not exit after handing its file over" >&2
  exit 1
fi
echo "pass: first.md and second.md open in their own windows, in one process ($pid)"
