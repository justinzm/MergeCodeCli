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
  `);

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (id, name, path, default_provider, created_at, updated_at)
     VALUES (?, ?, ?, 'claude', ?, ?)`
  ).run("p1", "E2EProject", projectDir, now, now);
  db.close();
}

test("settings page should render form instead of terminal", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mergecodecli-settings-"));
  const dbPath = path.join(root, "e2e.db");
  const projectDir = path.join(root, "project-a");
  fs.mkdirSync(projectDir, { recursive: true });
  setupDb(dbPath, projectDir);

  const app = await electron.launch({
    args: [path.resolve(__dirname, "../")],
    env: { ...process.env, MERGECODECLI_DB_PATH: dbPath }
  });
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");

  await win.getByRole("button", { name: "设置" }).click();
  const screenshotDir = path.join(process.cwd(), "test-results", "manual-check");
  fs.mkdirSync(screenshotDir, { recursive: true });
  await win.screenshot({ path: path.join(screenshotDir, "settings-page-after-click.png"), fullPage: true });

  await expect(win.getByText("变量配置（启动会话时注入环境）")).toBeVisible();
  await expect(win.getByRole("button", { name: "+ 新增变量" })).toBeVisible();
  await expect(win.locator(".settings-wrap .settings-form")).toBeVisible();
  await expect(win.locator(".terminal-wrap")).toBeHidden();
  await win.screenshot({ path: path.join(screenshotDir, "settings-page-asserted.png"), fullPage: true });

  await app.close();
});
