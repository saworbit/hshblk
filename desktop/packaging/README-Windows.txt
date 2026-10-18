Hash Block @VERSION@ for Windows

Hash Block opens a markdown file as a page, in a window of its own. It reads, and nothing in it can write, so your files are safe from it, and from me.

What is in here

- Hash Block setup.exe: installs the app for you alone, with no admin needed, and offers it for .md files.
- Hash Block.exe: the same app with nothing to install. Run it from anywhere, then open a file from its button or drop one on its window. It does not change what a double-click opens.
- README.txt: this. It would be a README.md, but you have not installed the thing that reads those yet.

Installing

1. Run Hash Block setup.exe.
2. SmartScreen warns, since the app is not signed yet. Choose More info, then Run anyway.
3. Double-click a .md file. If Windows asks which app to use, pick Hash Block.

It needs Windows 10 or 11 on x64, and WebView2, which Windows 11 has built in. The installer fetches WebView2 if it is missing. Hash Block.exe cannot, so on an older Windows 10, use the installer.

Uninstalling

Settings, Apps, Hash Block, Uninstall. Hash Block.exe just goes in the Recycle Bin.

More, and where to say what broke: https://github.com/saworbit/hshblk
