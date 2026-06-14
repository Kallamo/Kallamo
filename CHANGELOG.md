# Changelog

All notable changes to Kallamo are documented in this file. This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-06-14

### Security
- Rendered chat markdown now sanitizes image and link URLs and escapes AI-generated or imported content, preventing script injection (XSS) — including from shared `.klp` profiles.
- Packaged builds now enforce a strict Content-Security-Policy.
- The internal file protocol is restricted to an allowlist of viewable file types, so it can no longer be used to read arbitrary files from disk.

### Changed
- Fonts and code-highlighting themes are now bundled with the app instead of loaded from a CDN. Kallamo no longer makes third-party network requests for assets, loads them offline, and starts faster.

### Fixed
- AWS Bedrock requests now include the required SigV4 content-hash header.
- OpenRouter requests now report the correct app attribution.
- Dynamic variables containing special characters (e.g. `{{price(1)}}`) are now substituted correctly.
- Context budgeting and auto-archiving now use a real BPE token counter for more accurate token estimates across providers.

## [1.0.1] - 2026-06-13

### Fixed
- Resolved an `ENOTDIR` error in the embedding model cache.
- The About modal now reads the app version dynamically.
- Added a custom-memory notice in onboarding step 2.

## [1.0.0] - 2026-06-12

- Initial public release.
