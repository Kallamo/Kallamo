# Contributing to Kallamo

First off, thank you for taking the time to contribute. Kallamo is a free, open-source project, and it grows through the people who use it, test it, and improve it. Whether you're fixing a typo, reporting a bug, translating the interface, or building a new feature, your help is welcome.

This document explains how to get involved and what to expect.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Ways to Contribute](#ways-to-contribute)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)
- [Setting Up Your Environment](#setting-up-your-environment)
- [Development Workflow](#development-workflow)
- [Commit Conventions](#commit-conventions)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Contributor License Agreement (CLA)](#contributor-license-agreement-cla)
- [Coding Guidelines](#coding-guidelines)
- [Branding & Trademark](#branding--trademark)
- [Questions](#questions)

---

## Code of Conduct

Be respectful, be constructive, and assume good faith. We're all here to build something useful together. Harassment, personal attacks, or dismissive behavior toward other contributors won't be tolerated. If something feels off, reach out on [Discord](https://discord.com/invite/CE4C9JRS9H).

---

## Ways to Contribute

You don't need to write code to make a difference:

- **Test the app** and report what breaks or feels rough.
- **Report bugs** with clear reproduction steps.
- **Suggest features** or improvements.
- **Improve documentation** (README, `docs/`, this file, code comments).
- **Translate** the interface into other languages.
- **Write code** to fix bugs or add features.
- **Share your AI Profiles and Workflows** with the community on [Discord](https://discord.com/invite/CE4C9JRS9H).

---

## Reporting Bugs

Before opening an issue, please [search existing issues](https://github.com/Kallamo/Kallamo/issues) to avoid duplicates.

A good bug report includes:

- **What happened** and **what you expected** to happen.
- **Steps to reproduce** the problem, as precisely as you can.
- **Your environment**: OS and version, Kallamo version (shown in the app), and the AI provider you were using if relevant.
- **Logs or screenshots** if you have them. Kallamo writes logs via `electron-log`; including the relevant excerpt helps a lot.

[Open a bug report →](https://github.com/Kallamo/Kallamo/issues/new)

---

## Suggesting Features

Feature ideas are welcome. When proposing one, describe **the problem you're trying to solve**, not just the solution you have in mind. That context helps the discussion and often leads to a better design. Opening an issue (or raising it on Discord first) is the best way to start the conversation before investing time in code.

---

## Setting Up Your Environment

The full build instructions live in the [Developer Setup](README.md#developer-setup) section of the README. In short:

```bash
git clone https://github.com/Kallamo/Kallamo.git
cd Kallamo
npm install
npx @electron/rebuild        # rebuild native modules for Electron
npm run electron:dev         # Vite dev server + Electron with hot reload
```

You'll need **Node.js ≥ 18**, **Python ≥ 3.10**, and C++ build tools (required to compile `better-sqlite3`). See the README for the per-OS prerequisites.

---

## Development Workflow

1. **Fork** the repository and clone your fork.
2. **Create a branch** off `main` for your change:
   ```bash
   git checkout -b fix/short-description
   ```
   Use a short, descriptive name prefixed by the type of work (`fix/`, `feat/`, `docs/`, `refactor/`).
3. **Make your change** in focused, logically grouped commits.
4. **Test it locally** by running the app (`npm run electron:dev`) and exercising the affected feature.
5. **Push** to your fork and open a pull request against `main`.

Keep pull requests focused. Several small, self-contained PRs are easier to review and merge than one large one that mixes unrelated changes.

---

## Commit Conventions

Kallamo follows the [Conventional Commits](https://www.conventionalcommits.org/) style, matching the existing history:

```
type: short summary in the present tense
```

Common types: `fix`, `feat`, `docs`, `refactor`, `chore`, `release`.

Examples from the project:

```
fix: sync searchable RAG file chunks to SQLite db
docs: update CHANGELOG.md for v1.0.3
```

Write summaries in English, keep them concise, and describe *what* the change does.

---

## Submitting a Pull Request

When you open a PR, the [pull request template](.github/pull_request_template.md) will guide you through:

- A **description** of the change and the issue it addresses (use `Fixes #123` to auto-close the issue).
- The **type of change** (bug fix, feature, breaking change, docs, refactor).
- **How you tested it**, with steps to reproduce.
- A **checklist** confirming you've self-reviewed, updated docs where needed, and that the change introduces no new warnings.
- Confirmation that you've **read and agreed to the CLA**.

A maintainer will review your PR. Expect questions or change requests. This is normal and part of keeping the project healthy, not a rejection of your work. Please be patient: this is a young project maintained in spare time.

---

## Contributor License Agreement (CLA)

Before any contribution can be merged, you must read and agree to the [Kallamo Contributor License Agreement](CLA.md). You confirm your agreement by checking the CLA box in the pull request template.

The CLA exists to keep the project's licensing clear and to protect both you and the project. In short: you keep all rights to your original work (the license you grant is non-exclusive), while allowing the project to use, distribute, and potentially relicense it in the future. Crucially, any version already released under the AGPL stays open under the AGPL forever, so no contributor is ever locked in. Please read the [full text](CLA.md) before contributing.

---

## Coding Guidelines

- **Match the surrounding code.** Follow the existing structure, naming, and style of the file you're editing rather than introducing a new pattern.
- **Write in English.** Code, comments, commit messages, and documentation should all be in English so the whole community can read them.
- **Keep comments meaningful.** Comment the *why* behind non-obvious decisions, not the obvious *what*. Avoid noise.
- **Respect the architecture.** The Electron main process (`src/main/`), the secure IPC bridge (`src/preload.js`), and the React renderer (`src/renderer/`) are separated for a reason. Keep that boundary intact. See [docs/architecture.md](docs/architecture.md) for the full picture.
- **Test before you push.** There's no automated test suite yet, so manual verification of the affected feature is essential.

---

## Branding & Trademark

The source code is licensed under the [GNU AGPLv3](LICENSE), but the **Kallamo** name, logo, and branding are trademarks of the project creator. This doesn't affect contributing to the main project. It only means that any independent fork or redistribution must be renamed and rebranded. See the [Trademark Notice](README.md#trademark-notice) for details.

---

## Questions

If anything here is unclear, or you just want to talk through an idea before opening an issue, join us on [Discord](https://discord.com/invite/CE4C9JRS9H). We're happy to help you get started.

Thank you for contributing to Kallamo.
