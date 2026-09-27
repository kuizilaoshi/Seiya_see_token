# Project rules

Seiya See Token is a public Windows tray utility for Codex quota and local project usage. Keep README and release notes useful to all users.

- Entry: src/main.js; UI: src/index.html, src/styles.css, src/renderer.js.
- Preserve real quota readings and primary-window semantics; never replace failures with demonstration values.
- Never commit account files, session logs, personal data, installed dependencies, or machine-specific shortcuts.
- Installed builds use the SeiyaSeeToken user data directory, separate from source-run copies.
- npm test verifies data and refresh behavior; npm run dist produces a Windows x64 NSIS installer in dist.
- Keep Electron and third-party notices in the distributed package. Publish final files from _output; keep build and verification intermediates in dist.
