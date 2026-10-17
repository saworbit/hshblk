#!/bin/sh
# The Desktop workflow's Linux suites, in the container test/docker/Dockerfile makes (#303): the
# acceptance test, the click-target gate, and the double-click, each under Xvfb in a D-Bus session
# of its own, as the workflow's acceptance job runs them. docs/desktop.md has the commands.
#
# The checkout is mounted read-only at /src. What it has committed is cloned into the container's
# own filesystem, since a build on a Windows bind mount is slow, and the build goes to the volume
# at CARGO_TARGET_DIR. Root builds and installs the package. The reader, who has no password,
# runs the app.
set -eu

rm -rf /work
git -c safe.directory='*' clone --quiet /src /work
echo "Testing $(git -C /work log -1 --format='%h %s')"
cd /work/desktop
npm ci --no-audit --no-fund
npx tauri build --debug --bundles deb
dpkg -i "$CARGO_TARGET_DIR"/debug/bundle/deb/*.deb
chown -R reader /work

app="$CARGO_TARGET_DIR/debug/hshblk"
reader() {
  runuser -u reader -- env HOME=/home/reader \
    xvfb-run -a -s "-screen 0 1280x900x24" dbus-run-session -- "$@"
}
echo "Section 8, items 1, 2, 4, 5, and 6"
reader node test/acceptance.mjs "$app"
echo "Section 9, the click-target gate"
reader node test/gate/click-target.mjs "$app"
echo "Section 8, item 7, on Linux"
reader test/double-click.sh
