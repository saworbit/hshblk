Hash Block @VERSION@ for Linux

Hash Block opens a markdown file as a page, in a window of its own. It reads, and nothing in it can write, so your files are safe from it, and from me.

What is in here

- hash-block.deb: for Debian, Ubuntu, and their kin.
- hash-block.rpm: for Fedora, openSUSE, and theirs.
- hshblk: the app alone, for everything else. It is what both packages install.
- README.txt: this. It would be a README.md, but you have not installed the thing that reads those yet.

Installing

- Debian or Ubuntu: sudo apt install ./hash-block.deb
- Fedora: sudo dnf install ./hash-block.rpm
- Anything else: install WebKitGTK 4.1 from your distribution (webkit2gtk-4.1 on Arch), then run ./hshblk, or put it somewhere on your PATH.

The packages offer Hash Block for .md files, so a double-click can open them, if your file manager agrees. The app alone does not.

It is built on Ubuntu 24.04, so it wants a system about that new or newer. It uses your system's WebKitGTK rather than bringing its own, so its security fixes come from your distribution, not from me. That is better for everyone, me most of all.

Uninstalling

sudo apt remove hash-block, or sudo dnf remove hash-block. The app alone just goes in the bin.

If it takes 30 seconds to open, or anything else is odd: https://github.com/saworbit/hshblk/blob/main/docs/desktop.md
