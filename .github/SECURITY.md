# Security

## Report a vulnerability

If you find a security problem in Hash Block, report it privately: on GitHub, open the repository's **Security** tab and choose **Report a vulnerability**. Please don't open a public issue for it until it is fixed.

## What is a vulnerability?

Hash Block makes one promise about a markdown file, whoever wrote it: the file can only be read. A vulnerability is a file that breaks that promise:

- Script from the file runs.
- The page fetches anything because of the file: an image, a font, a stylesheet, a link.
- The file, or anything else, is written.

A file that renders wrongly is a bug, not a vulnerability. Please use the issue tracker for it.

The trust boundary for the planned desktop app is section 6 of [docs/hld.md](../docs/hld.md).

## What to include

- The smallest file that shows the problem.
- The browser, its version, and the operating system.
- What happened, and what should have happened.
