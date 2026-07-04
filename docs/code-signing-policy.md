# Kallamo Code Signing Policy

This document describes how Kallamo builds, reviews, and signs its release
artifacts. It exists to satisfy the transparency requirements of the
[SignPath Foundation](https://signpath.org/), which provides free code signing
for eligible open source projects.

## Signed artifacts

Only official Kallamo release binaries are signed:

- The Windows installer (`Kallamo-Setup-<version>.exe`) and its auto-update
  metadata (`latest.yml`, `.blockmap`).

Signing certificates are provided by the SignPath Foundation. The private
signing key is held exclusively in the SignPath infrastructure and is never
present on any developer machine or in the CI environment.

## License and distribution

Kallamo is distributed exclusively under the
[GNU Affero General Public License v3.0](../LICENSE) (`AGPL-3.0-only`).

The project's Contributor License Agreement reserves the right to re-license
future versions of the project. This reservation applies only to potential
future distributions; every version that has been released under the AGPL
remains permanently available under the AGPL, and no signed artifact is
distributed under any commercial or dual-license model.

## Team and roles

Kallamo is currently maintained by a single project owner, who holds all of the
roles below. As the project grows, these roles may be assigned to additional
trusted maintainers.

- **Author** — Writes and modifies the project's source code.
- **Reviewer** — Reviews all external contributions before they are merged.
- **Approver** — Approves each individual signing request before an artifact is
  signed.

All team members with access to the source repository or to the SignPath
account are required to have multi-factor authentication (MFA) enabled on both.

## Contribution and review process

- All source code lives in the public GitHub repository:
  <https://github.com/Kallamo/Kallamo>.
- External contributions are submitted as pull requests and are reviewed by a
  Reviewer before being merged. Contributors must accept the
  [Contributor License Agreement](../CLA.md).
- Releases are produced by an automated GitHub Actions workflow from a tagged
  commit. The resulting build artifacts are submitted to SignPath for signing,
  and each signing request is explicitly approved by an Approver.

## Privacy

Kallamo runs entirely on the user's machine and does not collect, transmit, or
harvest user data. API keys supplied by the user are encrypted at rest using
the operating system's secure storage. See the full
[Privacy Policy](../PRIVACY.md) for details.

## Reporting

To report a security concern or a suspicious binary claiming to be Kallamo,
please open an issue at <https://github.com/Kallamo/Kallamo/issues> or contact
the project owner directly.
