# The Desktop workflow's Linux machine, to run its Linux suites from a Windows or Mac checkout
# (#303): Ubuntu 24.04, Tauri's build packages, WebKitWebDriver, Xvfb, a D-Bus daemon, Node 24,
# Rust stable, and tauri-driver. No passwords anywhere. Root builds and installs; `reader`, who
# has none, runs the app. docs/desktop.md, "The Linux suites in Docker", says how to run it.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      libwebkit2gtk-4.1-dev build-essential libxdo-dev libssl-dev librsvg2-dev \
      webkit2gtk-driver xvfb xauth xdotool poppler-utils dbus-daemon dbus-x11 libglib2.0-bin \
      libgtk-3-bin shared-mime-info xdg-utils file \
      ca-certificates curl git xz-utils python3 \
    && rm -rf /var/lib/apt/lists/*

# Node 24, as .nvmrc names it, from nodejs.org, checked against its published sums.
RUN set -eux; \
    cd /tmp; \
    curl -fsSLO https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt; \
    name="$(grep -o 'node-v24[^ ]*-linux-x64.tar.xz' SHASUMS256.txt)"; \
    curl -fsSLO "https://nodejs.org/dist/latest-v24.x/$name"; \
    grep " $name\$" SHASUMS256.txt | sha256sum -c -; \
    tar -xJf "$name" -C /usr/local --strip-components=1; \
    rm -f "$name" SHASUMS256.txt; \
    node --version; npm --version

# Rust stable, through rustup, for every user, and the driver the workflow installs.
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo PATH=/usr/local/cargo/bin:$PATH
RUN set -eux; \
    curl -fsSL -o /tmp/rustup-init https://static.rust-lang.org/rustup/dist/x86_64-unknown-linux-gnu/rustup-init; \
    chmod +x /tmp/rustup-init; \
    /tmp/rustup-init -y --no-modify-path --profile minimal --default-toolchain stable; \
    rm /tmp/rustup-init; \
    cargo install tauri-driver --version 2.1.0 --locked; \
    rm -rf "$CARGO_HOME/registry"; \
    chmod -R a+rwX "$RUSTUP_HOME" "$CARGO_HOME"; \
    rustc --version; tauri-driver --help > /dev/null

# The reader runs the app. No password is set, and none is needed: root runs it with runuser.
RUN useradd --create-home --shell /bin/bash reader

# The build goes to a volume, not the checkout, which is mounted read-only.
ENV CARGO_TARGET_DIR=/build-target
CMD ["sh", "/src/desktop/test/docker/suites.sh"]
