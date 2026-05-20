const { test, expect } = require("@playwright/test");
const { _electron: electron } = require("playwright");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function setupDb(dbPath, projectAPath, projectBPath) {
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
  ).run("p1", "ProjectA", projectAPath, now, now);
  db.prepare(
    `INSERT INTO projects (id, name, path, default_provider, created_at, updated_at)
     VALUES (?, ?, ?, 'claude', ?, ?)`
  ).run("p2", "ProjectB", projectBPath, now, now);

  db.close();
}

function seedClaudeSession(homeDir, projectDir, sid, title) {
  const sessionPath = path.join(homeDir, ".claude", "projects", "sync-demo", `${sid}.jsonl`);
  ensureDir(path.dirname(sessionPath));
  fs.writeFileSync(
    sessionPath,
    `${JSON.stringify({ cwd: projectDir, message: { role: "user", content: title } })}\n`,
    "utf8"
  );
}

async function launchApp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mergecodecli-project-sync-"));
  const dbPath = path.join(root, "e2e.db");
  const projectAPath = path.join(root, "project-a");
  const projectBPath = path.join(root, "project-b");
  ensureDir(projectAPath);
  ensureDir(projectBPath);
  fs.writeFileSync(path.join(projectAPath, "a.txt"), "a", "utf8");
  fs.writeFileSync(path.join(projectBPath, "b.txt"), "b", "utf8");
  setupDb(dbPath, projectAPath, projectBPath);

  const sidA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const sidB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  seedClaudeSession(root, projectAPath, sidA, "session-project-a");
  seedClaudeSession(root, projectBPath, sidB, "session-project-b");

  const app = await electron.launch({
    args: [path.resolve(__dirname, "../")],
    env: {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      MERGECODECLI_DB_PATH: dbPath,
      SHELL: "/bin/bash"
    }
  });

  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  return { app, win, projectAPath, projectBPath, sidA, sidB };
}

async function syncAllProjectHistory(win) {
  const toggles = win.locator(".project-create-toggle");
  const count = await toggles.count();
  for (let i = 0; i < count; i += 1) {
    await toggles.nth(i).click({ force: true });
    await win.getByRole("button", { name: "读取历史会话" }).click({ force: true });
  }
}

test("switching project session updates explorer cwd and active terminal", async () => {
  const { app, win, projectAPath, projectBPath, sidA, sidB } = await launchApp();
  await syncAllProjectHistory(win);

  await expect(win.getByTestId(`session-item-${sidA}`)).toBeVisible();
  await expect(win.getByTestId(`session-item-${sidB}`)).toBeVisible();

  await win.getByTestId(`session-item-${sidA}`).click();
  await expect(win.locator(".explorer-root-path")).toHaveText(projectAPath);
  await expect(win.locator(`[data-session-id="${sidA}"]`)).toBeVisible();

  await win.getByTestId(`session-item-${sidB}`).click();
  await expect(win.locator(".explorer-root-path")).toHaveText(projectBPath);
  await expect(win.locator(`[data-session-id="${sidB}"]`)).toBeVisible();

  await app.close();
});
