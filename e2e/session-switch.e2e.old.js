const { test, expect } = require("@playwright/test");
const { _electron: electron } = require("playwright");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

function makeTempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mergecodecli-e2e-"));
  const dbPath = path.join(root, "e2e.db");
  const projectDir = path.join(root, "project-a");
  fs.mkdirSync(projectDir, { recursive: true });
  return { root, dbPath, projectDir };
}

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
  const projectId = "project-1";

  db.prepare(
    `INSERT INTO projects (id, name, path, default_provider, created_at, updated_at)
     VALUES (?, ?, ?, 'claude', ?, ?)`
  ).run(projectId, "E2EProject", projectDir, now, now);

  db.prepare(
    `INSERT INTO sessions (id, project_id, title, provider, provider_session_id, cwd, status, last_active_at, created_at, updated_at)
     VALUES (?, ?, ?, 'claude', NULL, ?, 'idle', ?, ?, ?)`
  ).run("session-a", projectId, "Chat A", projectDir, now, now, now);

  db.prepare(
    `INSERT INTO sessions (id, project_id, title, provider, provider_session_id, cwd, status, last_active_at, created_at, updated_at)
     VALUES (?, ?, ?, 'claude', NULL, ?, 'idle', ?, ?, ?)`
  ).run("session-b", projectId, "Chat B", projectDir, now, now, now);

  db.close();
  return { projectId };
}

test("switching between two sessions keeps both running", async () => {
  const { dbPath, projectDir } = makeTempWorkspace();
  const { projectId } = setupDb(dbPath, projectDir);

  const electronApp = await electron.launch({
    args: [path.resolve(__dirname, "../")],
    env: {
      ...process.env,
      MERGECODECLI_DB_PATH: dbPath
    }
  });

  const window = await electronApp.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  const sessionList = window.locator("[data-testid='project-tree']");

  await expect(sessionList.getByText("Chat A", { exact: true })).toBeVisible();
  await expect(sessionList.getByText("Chat B", { exact: true })).toBeVisible();

  await sessionList.getByText("Chat A", { exact: true }).click();
  await expect(window.getByText(/Chat A \(running\)/)).toBeVisible();

  await sessionList.getByText("Chat B", { exact: true }).click();
  await expect(window.getByText(/Chat B \(running\)/)).toBeVisible();

  await sessionList.getByText("Chat A", { exact: true }).click();
  await expect(window.getByText(/Chat A \(running\)/)).toBeVisible();

  const statuses = await window.evaluate(async ({ pid }) => {
    const list = await window.api.sessions.list(pid);
    const map = {};
    for (const s of list) map[s.id] = s.status;
    return map;
  }, { pid: projectId });

  expect(statuses["session-a"]).toBe("running");
  expect(statuses["session-b"]).toBe("running");

  await electronApp.close();
});
