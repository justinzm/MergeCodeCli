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

test("drained terminal writes stay responsive under heavy output", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mergecodecli-drain-"));
  const dbPath = path.join(root, "e2e.db");
  const projectDir = path.join(root, "project-a");
  fs.mkdirSync(projectDir, { recursive: true });
  setupDb(dbPath, projectDir);

  const app = await electron.launch({
    args: [path.resolve(__dirname, "../")],
    env: {
      ...process.env,
      MERGECODECLI_DB_PATH: dbPath,
      MERGECODECLI_CLAUDE_START_CMD: "bash -lc \"for i in $(seq 1 3000); do echo BURST_$i; done; cat\"",
      MERGECODECLI_CLAUDE_RESUME_CMD_TEMPLATE: "bash -lc \"for i in $(seq 1 3000); do echo BURST_$i; done; cat\""
    }
  });

  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");

  const sessionList = win.locator("[data-testid='project-tree']");
  await sessionList.getByText("Chat A", { exact: true }).click();
  await sessionList.getByText("Chat B", { exact: true }).click();

  for (let i = 0; i < 8; i += 1) {
    await sessionList.getByText("Chat A", { exact: true }).click();
    await sessionList.getByText("Chat B", { exact: true }).click();
  }

  await expect
    .poll(async () => win.evaluate(() => window.__MERGECODECLI_TEST__.getSessionBuffer("session-a")))
    .toContain("BURST_3000");

  await expect
    .poll(async () => win.evaluate(() => window.__MERGECODECLI_TEST__.getSessionBuffer("session-b")))
    .toContain("BURST_3000");

  await win.evaluate(async () => {
    await window.api.terminal.input("session-a", "AFTER_BURST_A\\r");
    await window.api.terminal.input("session-b", "AFTER_BURST_B\\r");
  });

  await expect
    .poll(async () => win.evaluate(() => window.__MERGECODECLI_TEST__.getSessionBuffer("session-a")))
    .toContain("AFTER_BURST_A");

  await expect
    .poll(async () => win.evaluate(() => window.__MERGECODECLI_TEST__.getSessionBuffer("session-b")))
    .toContain("AFTER_BURST_B");

  await sessionList.getByText("Chat A", { exact: true }).click();
  await expect(win.getByText(/Chat A \(running\)/)).toBeVisible();
  await expect(win.locator("[data-testid='terminal-wrap']")).toBeVisible();

  await app.close();
});
