# Kallamo Privacy Policy

_Last updated: 2026-07-04_

Kallamo is a desktop application that runs entirely on your own computer. It is
designed around a simple principle: **your data stays yours, on your machine.**

## What we collect

**Nothing.**

Kallamo has no backend servers, no analytics, no telemetry, and no accounts.
The project owner and contributors never receive your prompts, your documents,
your conversations, your API keys, or any usage data.

## Where your data lives

All application data — including your workspaces, AI profiles, chat history,
knowledge base files, vector embeddings, worldbuilding registries, and written
documents — is stored locally on your device in Kallamo's application data
directory. It never leaves your machine unless you explicitly export or share
it.

## API keys

Kallamo is a bring-your-own-key application. Any API keys you enter are:

- Stored locally and encrypted at rest using your operating system's secure
  storage (Electron `safeStorage`).
- Sent only to the AI provider you configured (for example OpenAI, Anthropic,
  Google, or a local server such as Ollama), and only when you make a request.

Kallamo never transmits your keys to the project or to any third party other
than the provider you chose.

## Third-party AI providers

When you connect an external AI provider and send a request, your prompt and any
retrieved context are transmitted directly from your machine to that provider's
API. That data is then subject to the provider's own privacy policy and terms.
Kallamo has no visibility into, or control over, how third-party providers
handle your requests. If you use a fully local provider (such as Ollama or
LM Studio), no data leaves your machine at all.

## Network connections

The only network connections Kallamo initiates on its own are:

- **Requests to the AI provider you configured**, when you send a prompt.
- **Automatic update checks** against the project's public GitHub Releases, to
  notify you when a new version is available. These checks download only public
  release metadata and do not transmit any personal data.

## Changes to this policy

If this policy changes, the updated version will be published in the project
repository with a new "Last updated" date.

## Contact

Questions about privacy can be raised at
<https://github.com/Kallamo/Kallamo/issues>.
