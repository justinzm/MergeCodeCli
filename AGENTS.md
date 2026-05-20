# AGENTS.md
始终以中文简体方式回答、编写文档

# MergeCodeCli · 迭代与更新规范

---

## 0. 当前项目目录结构

MergeCodeCli 是一个 Electron + React 的桌面应用，核心形态是“左侧项目/会话管理 + 中间 xterm 终端 + 右侧文件树”。主进程负责 Node 能力、PTY、SQLite、文件系统和 Provider 会话扫描；渲染进程只负责 React UI，通过 bridge 调用 preload 暴露的安全 IPC。

```text
.
├── src/
│   ├── electron/              # Electron 主进程：窗口、IPC handler、PTY、Provider
│   ├── bridge/                # 渲染进程 bridge 层，封装 preload 暴露的安全 IPC
│   ├── renderer/
│   │   ├── components/        # React UI 组件
│   │   └── store/             # Zustand 状态管理
│   ├── shared/                # 共享类型、IPC 枚举、常量
│   ├── main/db/               # SQLite 数据库模块
│   └── store/                 # 持久化 session store
├── docs/                      # 产品流程（flow-*.md）、架构约束（constraints.md）
├── e2e/                       # Playwright Electron 端到端测试
├── .Codex/                   # 项目级 Codex 配置与 skills
├── package.json               # 脚本、依赖、Electron main 入口
├── vite.config.mjs            # Vite 渲染进程构建配置
├── playwright.config.js       # E2E 测试配置
└── pnpm-workspace.yaml        # pnpm workspace 配置
```

当前 flow 文档：`flow-terminal.md`、`flow-multi-cli-session.md`、`flow-workspace-skillgen.md`

---

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | 启动开发环境（Vite + Electron 并行） |
| `pnpm build` | Vite 生产构建 |
| `pnpm start` | 直接启动 Electron（无 HMR） |
| `pnpm test` | 运行单元测试（`src/**/*.test.js`） |
| `pnpm test:e2e` | 运行 Playwright E2E 测试 |
| `pnpm dist:mac:arm64` | 打包 macOS ARM64 安装包 |

## Environment

- **包管理器**: pnpm（workspace，见 `pnpm-workspace.yaml`）
- **Node.js**: ≥ 18
- **构建工具**: Vite（渲染进程）+ electron-builder（打包）
- **桌面框架**: Electron，main 入口 `src/electron/main.js`
- **终端**: @xterm/xterm v5 + node-pty

## Testing

- **E2E**: `e2e/` 目录，Playwright + Electron，运行 `pnpm test:e2e`
- **单元测试**: `src/**/*.test.js`，通过 `electron --test` 运行
- E2E 测试前需先 `pnpm build`，因为测试依赖构建产物

---

## 1. 需求变更流程

```
产品想法
  → 更新对应 flow-*.md（先改文档，不得先改代码）
  → 如涉及新依赖，更新 docs/constraints.md Section 1
  → 如涉及新 IPC channel，更新 src/shared/types.ts 的 IPC 枚举
  → 将变更 diff 作为 context 注入 AI，执行对应 Task
```

**黄金规则：文档是代码的 source of truth。代码与文档不一致时，以文档为准，修代码。**

---

## 2. 向 AI 下达任务的上下文要求

下达任务时需提供：`@docs/constraints.md` 全文 + 对应 `docs/flow-*.md` 完整内容 + 本次 Task 描述。如遇歧义，先列问题待确认后再编码。

---

## 3. Task 执行顺序约束

- 同一 flow 内的 Task **必须按编号顺序执行**，后序 Task 依赖前序 Task 的类型定义
- 特别是：Task 1（types）→ Task 2-4（主进程）→ Task 5（preload）→ Task 6（bridge）→ Task 7（store）→ Task 8+（组件）
- 跨 flow 的依赖在 flow 文件的 `依赖` 字段中声明，被依赖 flow 必须先完成

---

## 4. 代码修改规范

### 修改已有文件时，AI 必须：

1. 复述当前文件的关键逻辑和对外接口
2. 说明本次修改的影响范围
3. 输出修改后的完整文件（不得用 `// ...` 省略）

### 禁止的修改模式：

- 禁止直接修改 `src/shared/types.ts` 的 IPC 枚举而不同步更新 preload.ts 和 bridge 层
- 禁止修改 PtyService 的公共方法签名而不同步更新 pty.handler.ts
- 禁止在渲染进程新增对 Node.js 模块的 import

---

## 5. 版本与分支策略

```
main          ← 稳定版本，只接受来自 feature/* 的 PR
feature/*     ← 每个 flow 对应一个 feature 分支，如 feature/terminal
fix/*         ← bug 修复，从 main 切出，合回 main
```

### Commit 规范（Conventional Commits）

```
feat(terminal): add QuickLaunch component
fix(pty): handle resize when terminal is hidden
refactor(bridge): extract pty.bridge from session.bridge
docs(flow): update terminal flow task list
```

格式：`{type}({scope}): {description}`

scope 对应目录：`terminal`、`sidebar`、`explorer`、`pty`、`bridge`、`store`、`ipc`

---

## 6. 变更分类与处理方式

| 变更类型 | 影响范围 | 处理方式 |
|----------|----------|----------|
| 新增 UI 组件 | 仅渲染进程 | 更新对应 flow，执行对应 Task |
| 新增 IPC channel | `src/shared/types.ts` + preload + bridge + handler | 严格按 Task 1→5→6→4 顺序执行 |
| 修改 PTY 行为 | 主进程 services + ipc | 更新 flow-terminal.md Section 5/6 |
| 新增 QuickLaunch 预设 | 仅 `src/shared/constants.ts` | 单文件修改，无依赖 |
| 新增项目功能（文件树等）| 需新建 flow-*.md | 走完整流程 |
| 性能优化 | 视范围 | 在对应 flow 中新增 Task，注明性能目标 |
| 依赖升级 | `package.json` + docs/constraints.md | 必须评审，不得 AI 自行升级 |


## 7. 参考文档
Gemini Cli：https://geminicli.org.cn/docs/get-started/configuration/#available-settings-in-settingsjson
Codex Cli：https://developers.openai.com/codex/cli/reference
Codex：https://code.Codex.com/docs/zh-CN/cli-reference


---

## 8. 上线验收清单

每个 feature 分支合并前，逐项检查：

- [ ] 对应 flow 文件的 Section 7 验收条件全部通过
- [ ] 无 `console.log` 残留（使用 electron-log）
- [ ] 无 `any` 类型（TypeScript strict 模式下无 error）
- [ ] 渲染进程无 Node.js 模块 import（检查 `require`、`import fs`、`import pty`）
- [ ] 所有 IPC channel 使用 `IPC.XXX` 枚举，无字符串字面量
- [ ] 多 session 切换无内存泄漏（xterm 实例不被重复创建）
- [ ] 应用退出时 PTY 进程全部被 kill（`destroyAll` 被调用）
- [ ] CSS 无硬编码颜色值（全部使用 CSS 变量）
