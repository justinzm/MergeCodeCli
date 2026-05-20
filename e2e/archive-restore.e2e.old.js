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

  db.prepare(
    `INSERT INTO sessions (id, project_id, title, provider, provider_session_id, cwd, status, last_active_at, created_at, updated_at)
     VALUES (?, ?, ?, 'claude', NULL, ?, 'idle', ?, ?, ?)`
  ).run("session-a", "p1", "Chat A", projectDir, now, now, now);

  db.prepare(
    `INSERT INTO sessions (id, project_id, title, provider, provider_session_id, cwd, status, last_active_at, created_at, updated_at)
     VALUES (?, ?, ?, 'claude', NULL, ?, 'idle', ?, ?, ?)`
  ).run("session-b", "p1", "Chat B", projectDir, now, now, now);

  db.close();
}

test("archive and restore session from settings", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mergecodecli-archive-"));
  const dbPath = path.join(root, "e2e.db");
  const projectDir = path.join(root, "project-a");
  fs.mkdirSync(projectDir, { recursive: true });
  setupDb(dbPath, projectDir);

  const screenshotDir = path.join(process.cwd(), "test-results", "manual-check");
  fs.mkdirSync(screenshotDir, { recursive: true });

  const app = await electron.launch({
    args: [path.resolve(__dirname, "../")],
    env: { ...process.env, MERGECODECLI_DB_PATH: dbPath, MERGECODECLI_CLAUDE_START_CMD: "cat", MERGECODECLI_CLAUDE_RESUME_CMD_TEMPLATE: "cat" }
  });

  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");

  await win.locator("[data-testid='session-item-session-b']").click();
  await expect(win.locator("[data-testid='session-item-session-b']")).toHaveClass(/active/);
  await expect(win.locator("[data-testid='session-item-session-a']")).not.toHaveClass(/active/);

  await win.locator("[data-testid='session-item-session-b'] .session-archive").click();
  await expect(win.locator("[data-testid='session-item-session-b']")).toHaveCount(0);

  await win.getByRole("button", { name: "设置", exact: true }).click();
  await expect(win.locator(".archived-list")).toContainText("Chat B · E2EProject");
  await win.screenshot({ path: path.join(screenshotDir, "archive-before-restore.png"), fullPage: true });

  await win.locator(".archived-row", { hasText: "Chat B · E2EProject" }).getByRole("button", { name: "恢复" }).click();
  await win.locator("[data-testid='project-p1'] .project-head").click();
  await win.locator("[data-testid='project-p1'] .project-head").click();
  await expect(win.locator("[data-testid='session-item-session-b']")).toBeVisible();

  await win.screenshot({ path: path.join(screenshotDir, "archive-after-restore.png"), fullPage: true });

  await app.close();
});
