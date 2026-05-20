const { test, expect } = require("@playwright/test");
const { _electron: electron } = require("playwright");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

function setupDb(dbPath, projectDir) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      default_provider TEXT NOT NULL DEFAULT 'claude',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_session_id TEXT,
      cwd TEXT NOT NULL,
      status TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (id, name, path, default_provider, created_at, updated_at)
     VALUES (?, ?, ?, 'claude', ?, ?)`
  ).run("p1", "E2EProject", projectDir, now, now);

  db.close();
}

test("save settings then create session should inject env vars into claude process", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mergecodecli-settings-env-"));
  const dbPath = path.join(root, "e2e.db");
  const projectDir = path.join(root, "project-a");
  fs.mkdirSync(projectDir, { recursive: true });
  setupDb(dbPath, projectDir);

  const screenshotDir = path.join(process.cwd(), "test-results", "manual-check");
  fs.mkdirSync(screenshotDir, { recursive: true });

  const apiUrl = "https://api.anthropic.com";
  const apiKey = "sk-e2e-123";
  const model = "claude-3-5-sonnet-20241022";
  const extraKey = "ANTHROPIC_SMALL_FAST_MODEL";
  const extraValue = "claude-3-5-haiku-20241022";

  const app = await electron.launch({
    args: [path.resolve(__dirname, "../")],
    env: {
      ...process.env,
      MERGECODECLI_DB_PATH: dbPath,
      MERGECODECLI_CLAUDE_START_CMD: "printenv",
      MERGECODECLI_CLAUDE_RESUME_CMD_TEMPLATE: "printenv"
    }
  });

  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");

  await win.getByRole("button", { name: "设置" }).click();
  await expect(win.getByText("变量配置（启动会话时注入环境）")).toBeVisible();

  async function addEnvPair(key, value) {
    await win.getByRole("button", { name: /新增变量/ }).click();
    const row = win.locator(".env-row").last();
    await row.locator("input").nth(0).fill(key);
    await row.locator("input").nth(1).fill(value);
  }

  await addEnvPair("ANTHROPIC_BASE_URL", apiUrl);
  await addEnvPair("ANTHROPIC_AUTH_TOKEN", apiKey);
  await addEnvPair("ANTHROPIC_MODEL", model);
  await addEnvPair(extraKey, extraValue);

  await win.getByRole("button", { name: "保存设置" }).click();
  await expect(win.getByText("已保存")).toBeVisible();
  await win.screenshot({ path: path.join(screenshotDir, "settings-env-saved.png"), fullPage: true });

  await win.locator("[data-testid='project-p1']").getByRole("button", { name: "+ 新建会话" }).click();

  const activeSessionId = await expect
    .poll(async () => win.evaluate(() => window.__MERGECODECLI_TEST__.getActiveSessionId()))
    .not.toBeNull();
  void activeSessionId;

  await expect
    .poll(async () => {
      const sid = await win.evaluate(() => window.__MERGECODECLI_TEST__.getActiveSessionId());
      if (!sid) return "";
      return win.evaluate((id) => window.__MERGECODECLI_TEST__.getSessionBuffer(id), sid);
    })
    .toContain(`ANTHROPIC_BASE_URL=${apiUrl}`);

  await expect
    .poll(async () => {
      const sid = await win.evaluate(() => window.__MERGECODECLI_TEST__.getActiveSessionId());
      if (!sid) return "";
      return win.evaluate((id) => window.__MERGECODECLI_TEST__.getSessionBuffer(id), sid);
    })
    .toContain(`ANTHROPIC_AUTH_TOKEN=${apiKey}`);

  await expect
    .poll(async () => {
      const sid = await win.evaluate(() => window.__MERGECODECLI_TEST__.getActiveSessionId());
      if (!sid) return "";
      return win.evaluate((id) => window.__MERGECODECLI_TEST__.getSessionBuffer(id), sid);
    })
    .toContain(`ANTHROPIC_MODEL=${model}`);

  await expect
    .poll(async () => {
      const sid = await win.evaluate(() => window.__MERGECODECLI_TEST__.getActiveSessionId());
      if (!sid) return "";
      return win.evaluate((id) => window.__MERGECODECLI_TEST__.getSessionBuffer(id), sid);
    })
    .toContain(`${extraKey}=${extraValue}`);

  await win.evaluate(() => {
    const sid = window.__MERGECODECLI_TEST__.getActiveSessionId();
    const buf = sid ? window.__MERGECODECLI_TEST__.getSessionBuffer(sid) : "";
    const important = (buf || "")
      .split(/\r?\n/)
      .filter((line) => line.startsWith("ANTHROPIC_") || line.startsWith("CLAUDE_"))
      .join("\n");
    const preview = document.createElement("pre");
    preview.id = "e2e-buffer-preview";
    preview.textContent = important || (buf || "").slice(0, 1200);
    preview.style.position = "fixed";
    preview.style.right = "12px";
    preview.style.bottom = "12px";
    preview.style.width = "520px";
    preview.style.maxHeight = "220px";
    preview.style.overflow = "auto";
    preview.style.background = "#fff";
    preview.style.color = "#111";
    preview.style.border = "1px solid #bbb";
    preview.style.padding = "8px";
    preview.style.font = "12px/1.4 Menlo, Consolas, monospace";
    preview.style.zIndex = "99999";
    preview.style.whiteSpace = "pre-wrap";
    document.body.appendChild(preview);
  });

  await win.waitForTimeout(600);
  await win.screenshot({ path: path.join(screenshotDir, "settings-env-terminal-after-create.png"), fullPage: true });

  await app.close();
});
