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

  db.close();
}

function countOccurrences(text, needle) {
  const m = text.match(new RegExp(needle, "g"));
  return m ? m.length : 0;
}

test("first session should not duplicate rendered text after one message", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mergecodecli-dup-check-"));
  const dbPath = path.join(root, "e2e.db");
  const projectDir = path.join(root, "project-a");
  fs.mkdirSync(projectDir, { recursive: true });
  setupDb(dbPath, projectDir);

  const screenshotDir = path.join(process.cwd(), "test-results", "manual-check");
  fs.mkdirSync(screenshotDir, { recursive: true });

  const message = "ONLY_ONCE_MARKER_7788";

  const app = await electron.launch({
    args: [path.resolve(__dirname, "../")],
    env: {
      ...process.env,
      MERGECODECLI_DB_PATH: dbPath,
      MERGECODECLI_CLAUDE_START_CMD: "cat",
      MERGECODECLI_CLAUDE_RESUME_CMD_TEMPLATE: "cat"
    }
  });

  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  const sessionList = win.locator("[data-testid='project-tree']");

  await sessionList.getByText("Chat A", { exact: true }).click();
  await expect(win.getByText(/Chat A \(running\)/)).toBeVisible();

  await win.locator(".terminal-wrap").click();
  await win.keyboard.type(message);
  await win.keyboard.press("Enter");

  await expect
    .poll(async () => {
      const buf = await win.evaluate(() => window.__MERGECODECLI_TEST__.getRenderedText());
      return countOccurrences(buf, message);
    })
    .toBeGreaterThanOrEqual(1);

  const beforeSwitchCount = await win.evaluate((m) => {
    const rendered = window.__MERGECODECLI_TEST__.getRenderedText();
    return (rendered.match(new RegExp(m, "g")) || []).length;
  }, message);

  await win.getByRole("button", { name: "设置" }).click();
  await expect(win.getByText("变量配置（启动会话时注入环境）")).toBeVisible();
  await sessionList.getByText("Chat A", { exact: true }).click();
  await expect(win.getByText(/Chat A \(running\)/)).toBeVisible();

  await win.locator(".terminal-wrap").hover();
  await win.mouse.wheel(0, 800);
  await win.mouse.wheel(0, -800);

  const afterSwitchCount = await win.evaluate((m) => {
    const rendered = window.__MERGECODECLI_TEST__.getRenderedText();
    return (rendered.match(new RegExp(m, "g")) || []).length;
  }, message);

  await win.screenshot({ path: path.join(screenshotDir, "first-session-duplicate-check.png"), fullPage: true });

  expect(afterSwitchCount).toBeLessThanOrEqual(beforeSwitchCount + 1);

  await app.close();
});
