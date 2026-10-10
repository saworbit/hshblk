# Security

## Report a vulnerability

If you find a security problem in Hash Block, report it privately: on GitHub, open the repository's **Security** tab and choose **Report a vulnerability**. Please don't open a public issue for it until it is fixed.

## What is a vulnerability?

Hash Block makes one promise about a markdown file, whoever wrote it: the file can only be read. A vulnerability is a file that breaks that promise.

In the desktop app:

- Script from the file runs.
- The app fetches anything from the network because of the file.
- The page reads a file outside the document's repository, or a file that is not an image, through an image reference.
- The page learns a filesystem path.
- The file, or anything else, is written.

The desktop app's trust boundary is section 6 of [docs/hld.md](../docs/hld.md).

In the browser reader:

- Script from the file runs.
- The page fetches anything because of the file: an image, a font, a stylesheet, a link.
- The file, or anything else, is written.

A file that renders wrongly is a bug, not a vulnerability. Please use the issue tracker for it.

## What to include

- The smallest file that shows the problem.
- Which program: the desktop app and its version, or the browser reader and the browser's version.
- The operating system. On Linux, the WebKitGTK version too.
- What happened, and what should have happened.
