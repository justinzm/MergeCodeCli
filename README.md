# MergeCodeCli

**MergeCodeCli is a desktop workspace for running, discovering, resuming, and switching between multiple AI coding CLIs in one place.**

It is built for developers who use more than one coding assistant, such as Claude Code, Codex CLI, and Gemini CLI, and want a smoother way to work across them without losing project context, terminal state, or session history.

[中文文档](./README_CN.md)

## Why MergeCodeCli

Most AI coding CLIs are powerful, but they usually live in separate terminals, store sessions in different places, and make it awkward to move from one assistant to another during the same engineering task.

MergeCodeCli treats the local project as the center of the workflow:

- one workspace can contain sessions from different CLI providers;
- each provider keeps its own native session model and resume behavior;
- sessions are grouped by project so you can switch between Claude Code, Codex CLI, and Gemini CLI without manually hunting through terminal windows;
- the file tree, working directory, provider settings, and session list stay visible while the terminal remains the primary working surface.

The core idea is not to replace the CLIs. MergeCodeCli orchestrates them as first-class tools around the same local codebase.

## Highlights

- **Multi-CLI workspace**: manage Claude Code, Codex CLI, and Gemini CLI sessions from one desktop app.
- **Shared project context**: organize sessions from different providers under the same project path, file tree, and task workspace.
- **Fluid session switching**: switch between sessions without recreating terminal panes or losing the active provider state.
- **Native session discovery**: scan local provider session files and map them back to projects where possible.
- **Provider-aware resume**: resume sessions with the right CLI command for Claude, Codex, or Gemini.
- **Persistent local data**: projects, sessions, archive state, settings, and provider profiles are stored locally in SQLite.
- **xterm-based terminal**: run real PTY-backed CLI processes inside the app.
- **Right-side file explorer**: keep the project tree visible next to the active terminal.
- **Provider settings center**: configure API keys, OAuth profiles, model variables, base URLs, proxy testing, and startup environment variables.
- **Archive and restore**: archive old sessions without deleting provider history, then restore them when needed.
- **Local-first architecture**: no hosted backend is required; the app works against your local filesystem and installed/bundled CLIs.

## Supported CLIs

MergeCodeCli currently includes provider integration for:

| Provider | Launch | Resume | Session Discovery | Notes |
| --- | --- | --- | --- | --- |
| Claude Code | Supported | Supported | Supported | Uses Claude session files and resume IDs |
| Codex CLI | Supported | Supported | Supported | Uses Codex session files and resume commands |
| Gemini CLI | Supported | Supported | Supported | Supports API key and OAuth-oriented flows |

The project is designed so more providers can be added through provider launchers, session source scanners, settings profiles, and IPC-safe renderer bridges.

## Core Workflow

1. Add a local project folder.
2. Create or discover sessions for Claude Code, Codex CLI, or Gemini CLI.
3. Work in the embedded terminal.
4. Switch to another provider session when you want a different model, tool behavior, or reasoning style.
5. Keep the same project/file context visible while each CLI keeps its own native conversation/session state.
6. Archive completed sessions and restore them later if needed.

This makes it practical to use multiple AI coding assistants on the same repository without constantly rebuilding context by hand.

## Architecture

MergeCodeCli is an Electron + React desktop application.

```text
.
├── src/
│   ├── electron/              # Electron main process: window, IPC, PTY, provider orchestration
│   ├── bridge/                # Renderer bridge wrappers around preload-exposed IPC
│   ├── renderer/              # React UI
│   │   ├── components/        # Settings, sidebar, explorer, app shell
│   │   └── store/             # Zustand state management
│   ├── features/terminal/     # Terminal UI, panes, tabs, xterm hooks
│   ├── shared/                # Shared app config, IPC constants, public types
│   └── main/db/               # SQLite schema and repositories
├── e2e/                       # Playwright Electron tests
├── scripts/                   # CLI runtime preparation and notarization helpers
├── package.json               # Scripts, dependencies, Electron entry point
├── vite.config.mjs            # Renderer build configuration
└── electron-builder.json      # Desktop packaging configuration
```

### Process Boundaries

- The **main process** owns Node.js capabilities: filesystem, PTY, SQLite, provider scanning, CLI launch commands, OAuth probing, logging, and Electron window lifecycle.
- The **preload layer** exposes a narrow, safe IPC API.
- The **renderer process** owns React UI only. It does not import Node.js modules directly.
- Shared constants and IPC names live under `src/shared` to avoid stringly-typed channel drift.

## Tech Stack

- Electron
- React 18
- Vite
- xterm.js
- node-pty
- better-sqlite3
- Zustand
- Playwright Electron
- electron-builder
- pnpm workspace

## Getting Started

### Prerequisites

- Node.js 18 or newer
- pnpm
- A platform supported by Electron
- Optional provider accounts/API keys depending on which CLI you use

Node.js LTS is recommended for local development, especially because native modules such as `better-sqlite3` and `node-pty` may need to build against your local toolchain.

### Install

```bash
pnpm install
```

### Run in Development

```bash
pnpm dev
```

This starts the Vite renderer dev server and then launches Electron against it.

### Build

```bash
pnpm build
```

### Run Unit Tests

```bash
pnpm test
```

### Run E2E Tests

```bash
pnpm test:e2e
```

E2E tests build the renderer and launch Electron through Playwright.

### Package Desktop Builds

```bash
pnpm dist:mac:arm64
pnpm dist:mac:x64
pnpm dist:win
```

The packaging scripts prepare the CLI runtime, build the renderer, and then run `electron-builder`.

## CLI Runtime

MergeCodeCli can use CLI entrypoints from:

1. a prepared bundled runtime under `build/cli-runtime/<platform>-<arch>`;
2. packaged Electron resources;
3. local project dependencies during development.

Prepare the runtime manually with:

```bash
pnpm prepare:cli-runtime
```

You can override the runtime directory with:

```bash
MERGECODECLI_CLI_RUNTIME_DIR=/absolute/path/to/runtime pnpm dev
```

## Local Data

By default, app data is stored under:

```text
~/.mergecodecli
~/.mergecodeclidev
```

The SQLite database filename is:

```text
mergecodecli.sqlite
```

For tests or isolated runs, override the database path:

```bash
MERGECODECLI_DB_PATH=/tmp/mergecodecli.sqlite pnpm dev
```

Legacy `ZEELIN_*` paths and database names are kept as compatibility fallbacks for renamed installations.

## Provider Configuration

Provider settings are managed inside the app. The settings UI supports:

- provider profiles;
- API key and OAuth-oriented profiles;
- model environment variables;
- provider base URLs;
- proxy environment variables;
- provider connectivity checks;
- OAuth login/probe helpers.

The app injects configured environment variables when launching provider CLI sessions, while keeping provider-specific behavior inside the main process.

## Development Notes

- Keep Electron/Node APIs in `src/electron` or preload only.
- Do not import `fs`, `path`, `node-pty`, or other Node.js modules from renderer code.
- Add new IPC channels through shared constants and update preload + bridge + handler together.
- Provider behavior should usually live in:
  - `src/electron/providers/cli-launchers.js`
  - `src/electron/providers/session-sources.js`
  - `src/electron/services/provider-settings-runtime.js`
- Terminal lifecycle changes should be validated against xterm instance reuse and PTY cleanup.

## Roadmap Ideas

- More provider adapters.
- Richer cross-provider session comparison.
- Better context handoff between provider sessions.
- Import/export workspace metadata.
- Release automation for signed macOS and Windows builds.
- More E2E coverage around provider discovery and archive/restore flows.

## Contributing

Contributions are welcome. Good first areas include:

- provider session scanners;
- CLI launch/resume adapters;
- settings UI improvements;
- E2E tests;
- documentation and release packaging;
- performance work around large session lists or file trees.

Before opening a PR:

```bash
pnpm build
pnpm test
```

For UI or session behavior changes, also run:

```bash
pnpm test:e2e
```

## License

MergeCodeCli is released under the [MIT License](./LICENSE).

## Package Publishing Policy

`package.json` keeps `"private": true` because this repository is intended to be published as an open source GitHub project and desktop application, not as an npm package. Keep it enabled unless you explicitly decide to publish `merge-code-cli` to npm.
