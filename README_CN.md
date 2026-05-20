# MergeCodeCli

**MergeCodeCli 是一个用于统一运行、发现、恢复和切换多个 AI 编程 CLI 的桌面工作台。**

它面向同时使用 Claude Code、Codex CLI、Gemini CLI 等工具的开发者。你可以把不同 CLI 的会话集中到同一个项目工作区里，在同一套项目上下文、文件树、终端面板和会话列表中流畅切换，而不必反复打开多个终端窗口、手动寻找历史会话或重新组织上下文。

[English README](./README.md)

## 为什么需要 MergeCodeCli

现在的 AI 编程 CLI 都很强，但它们通常各自运行在独立终端里，会话存储位置不同，恢复方式不同，切换工具时也容易打断工作流。

MergeCodeCli 的核心思路是：**让本地项目成为中心，让不同 AI CLI 围绕同一个代码库协作。**

它不会替代 Claude Code、Codex CLI 或 Gemini CLI，而是把它们作为一等工具统一组织起来：

- 同一个项目下可以管理不同 Provider 的 sessions；
- 每个 CLI 保留自己的原生会话、恢复逻辑和上下文格式；
- 应用负责发现、归档、恢复和切换这些会话；
- 左侧项目/会话、中间终端、右侧文件树始终围绕当前代码库组织；
- 你可以根据任务需要，在不同 CLI 的能力、模型风格和交互方式之间切换。

这也是 MergeCodeCli 最大的亮点：**多个 Code CLI 聚合在一起，不同 CLI 的 session 可以围绕同一个项目上下文工作，并且可以自然、流畅地切换。**

## 核心亮点

- **多 CLI 聚合工作台**：统一管理 Claude Code、Codex CLI、Gemini CLI 会话。
- **共享项目上下文**：不同 CLI 的会话可以归属于同一个项目目录，共用工作区、文件树和任务背景。
- **流畅 session 切换**：切换会话时保留终端面板状态，避免重复创建 xterm 实例或丢失当前 Provider 状态。
- **原生会话发现**：扫描本机 Provider 会话文件，并尽可能映射回对应项目。
- **Provider 感知恢复**：根据不同 CLI 使用正确的 resume 命令恢复历史 session。
- **本地持久化**：项目、会话、归档状态、设置和 Provider profile 存储在本地 SQLite 中。
- **真实终端能力**：基于 xterm.js + node-pty 运行真实 CLI 进程。
- **右侧文件树**：在使用终端时仍能查看项目文件结构。
- **设置中心**：支持 API Key、OAuth profile、模型变量、Base URL、代理测试和启动环境变量配置。
- **会话归档/恢复**：完成的会话可以归档，不删除 Provider 原始历史，需要时再恢复。
- **本地优先**：不依赖托管后端，主要围绕本地文件系统、本地数据库和本机 CLI 运行。

## 当前支持的 CLI

| Provider | 启动 | 恢复 | Session 发现 | 说明 |
| --- | --- | --- | --- | --- |
| Claude Code | 支持 | 支持 | 支持 | 使用 Claude 会话文件和 resume ID |
| Codex CLI | 支持 | 支持 | 支持 | 使用 Codex 会话文件和 resume 命令 |
| Gemini CLI | 支持 | 支持 | 支持 | 支持 API Key 与 OAuth 相关流程 |

项目结构已经为扩展更多 Provider 预留了位置：Provider launcher、session scanner、settings profile 和安全 IPC bridge 都可以逐步扩展。

## 典型工作流

1. 添加一个本地项目目录。
2. 创建或发现 Claude Code、Codex CLI、Gemini CLI 的会话。
3. 在内嵌终端中继续使用对应 CLI。
4. 当你希望换一个模型、工具行为或推理风格时，切换到另一个 Provider 的 session。
5. 右侧文件树、当前项目、会话列表和 Provider 状态保持统一。
6. 已完成的 session 可以归档，后续需要时再恢复。

这个工作流适合在同一个代码仓库里同时利用多个 AI 编程助手：Claude 适合某类实现，Codex 适合另一类修改，Gemini 适合另一种检查或探索，而 MergeCodeCli 负责把这些会话收拢到同一个项目视角下。

## 架构概览

MergeCodeCli 是一个 Electron + React 桌面应用。

```text
.
├── src/
│   ├── electron/              # Electron 主进程：窗口、IPC、PTY、Provider 编排
│   ├── bridge/                # 渲染进程 bridge，封装 preload 暴露的安全 IPC
│   ├── renderer/              # React UI
│   │   ├── components/        # 设置、侧边栏、文件树、应用外壳
│   │   └── store/             # Zustand 状态管理
│   ├── features/terminal/     # 终端 UI、pane、tabs、xterm hooks
│   ├── shared/                # 共享 app config、IPC 常量、公共类型
│   └── main/db/               # SQLite schema 和 repository
├── e2e/                       # Playwright Electron 端到端测试
├── scripts/                   # CLI runtime 准备和 notarization 辅助脚本
├── package.json               # 脚本、依赖、Electron main 入口
├── vite.config.mjs            # 渲染进程构建配置
└── electron-builder.json      # 桌面端打包配置
```

### 进程边界

- **主进程** 负责 Node 能力：文件系统、PTY、SQLite、Provider 会话扫描、CLI 启动命令、OAuth 探测、日志和窗口生命周期。
- **preload 层** 暴露有限、安全的 IPC API。
- **渲染进程** 只负责 React UI，不直接 import Node.js 模块。
- 共享常量和 IPC 名称放在 `src/shared`，避免 IPC channel 字符串散落在不同层。

## 技术栈

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

## 快速开始

### 环境要求

- Node.js 18 或更高版本
- pnpm
- Electron 支持的桌面平台
- 根据你使用的 Provider，准备对应账号、API Key 或 OAuth 登录

本地开发建议使用 Node.js LTS。`better-sqlite3`、`node-pty` 等原生依赖可能需要匹配本机编译工具链。

### 安装依赖

```bash
pnpm install
```

### 开发模式启动

```bash
pnpm dev
```

该命令会启动 Vite 渲染进程开发服务器，然后启动 Electron。

### 构建

```bash
pnpm build
```

### 单元测试

```bash
pnpm test
```

### E2E 测试

```bash
pnpm test:e2e
```

E2E 测试会先构建渲染进程，再通过 Playwright 启动 Electron。

### 桌面端打包

```bash
pnpm dist:mac:arm64
pnpm dist:mac:x64
pnpm dist:win
```

打包脚本会准备 CLI runtime、构建渲染进程，然后运行 `electron-builder`。

## CLI Runtime

MergeCodeCli 可以从以下位置寻找 CLI 入口：

1. `build/cli-runtime/<platform>-<arch>` 下准备好的 bundled runtime；
2. 打包后的 Electron resources；
3. 开发阶段的项目本地依赖。

手动准备 runtime：

```bash
pnpm prepare:cli-runtime
```

也可以通过环境变量指定 runtime 目录：

```bash
MERGECODECLI_CLI_RUNTIME_DIR=/absolute/path/to/runtime pnpm dev
```

## 本地数据

默认应用数据目录：

```text
~/.mergecodecli
~/.mergecodeclidev
```

SQLite 数据库文件名：

```text
mergecodecli.sqlite
```

测试或隔离运行时可以指定数据库路径：

```bash
MERGECODECLI_DB_PATH=/tmp/mergecodecli.sqlite pnpm dev
```

旧版本的 `ZEELIN_*` 路径和数据库名仍作为兼容 fallback 保留，用于已安装用户平滑迁移。

## Provider 配置

Provider 设置在应用内完成，当前支持：

- Provider profiles；
- API Key 和 OAuth 相关 profile；
- 模型环境变量；
- Provider Base URL；
- 代理环境变量；
- Provider 连通性测试；
- OAuth login/probe 辅助流程。

应用会在启动 Provider CLI 会话时注入已配置的环境变量，同时把 Provider 特定逻辑限制在主进程中，避免渲染进程直接接触 Node 能力或敏感运行时细节。

## 开发约束

- Electron/Node 能力应放在 `src/electron` 或 preload 层。
- 渲染进程不要直接 import `fs`、`path`、`node-pty` 等 Node.js 模块。
- 新增 IPC channel 时，需要同步更新 shared constants、preload、bridge 和 handler。
- Provider 行为通常放在：
  - `src/electron/providers/cli-launchers.js`
  - `src/electron/providers/session-sources.js`
  - `src/electron/services/provider-settings-runtime.js`
- 修改终端生命周期时，需要关注 xterm 实例复用和 PTY 进程清理。

## Roadmap 想法

- 支持更多 Provider。
- 更强的跨 Provider session 对比能力。
- 更自然的 Provider 之间上下文交接。
- 工作区元数据导入/导出。
- macOS / Windows 签名发布自动化。
- 覆盖 Provider 发现、归档、恢复等关键流程的更多 E2E 测试。

## 参与贡献

欢迎贡献。比较适合切入的方向：

- Provider session scanner；
- CLI launch/resume adapter；
- 设置页体验优化；
- E2E 测试；
- 文档和发布打包；
- 大量 session 或大型文件树场景下的性能优化。

提交 PR 前建议先运行：

```bash
pnpm build
pnpm test
```

如果修改了 UI、终端或 session 行为，也建议运行：

```bash
pnpm test:e2e
```

## 开源许可证

MergeCodeCli 使用 [MIT License](./LICENSE) 开源。

## 包发布策略

`package.json` 保留 `"private": true`。当前策略是把仓库作为 GitHub 开源项目和桌面应用发布，而不是发布为 npm 包；保留该字段可以防止误发布到 npm。只有明确决定把 `merge-code-cli` 发布到 npm 时，才需要移除或改动它。
