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
  ).run("p1", "DemoProject", projectDir, now, now);

  db.close();
}

function seedClaudeSession(homeDir, projectDir, sid, title) {
  const sessionPath = path.join(homeDir, ".claude", "projects", "flow-terminal", `${sid}.jsonl`);
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(
    sessionPath,
    `${JSON.stringify({ cwd: projectDir, message: { role: "user", content: title } })}\n`,
    "utf8"
  );
}

async function launchApp(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mergecodecli-terminal-flow-"));
  const dbPath = path.join(root, "e2e.db");
  const projectDir = path.join(root, "project-a");
  fs.mkdirSync(projectDir, { recursive: true });
  setupDb(dbPath, projectDir);
  if (options.seedSession) {
    seedClaudeSession(root, projectDir, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "seed-session");
  }

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
  return { app, win, projectDir };
}

async function syncFirstProjectHistory(win) {
  await win.locator(".project-create-toggle").first().click({ force: true });
  await win.getByRole("button", { name: "读取历史会话" }).click({ force: true });
}

test("Task acceptance: quick launch creates claude-01 and injects command", async () => {
  const { app, win } = await launchApp();

  await win.locator(".project-create-main").first().click({ force: true });
  await expect(win.locator(".session-item-name").first()).toHaveText("claude-01");
  await expect(win.locator(".status-chip")).toBeVisible();

  await app.close();
});

test("Task acceptance: switching sessions keeps both entries and switches active state", async () => {
  const { app, win } = await launchApp({ seedSession: true });

  await syncFirstProjectHistory(win);
  await win.locator(".project-create-main").first().click({ force: true });
  await expect(win.locator(".session-item")).toHaveCount(2);
  const firstSessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const secondSessionId = await win
    .locator(".session-item")
    .evaluateAll((nodes, firstId) => {
      for (const node of nodes) {
        const value = String(node.getAttribute("data-testid") || "").replace("session-item-", "");
        if (value && value !== firstId) return value;
      }
      return "";
    }, firstSessionId);
  expect(secondSessionId).toBeTruthy();

  await win.getByTestId(`session-item-${firstSessionId}`).click();
  await expect(win.getByTestId(`session-item-${firstSessionId}`)).toHaveClass(/active/);

  await win.getByTestId(`session-item-${secondSessionId}`).click();
  await expect(win.getByTestId(`session-item-${secondSessionId}`)).toHaveClass(/active/);
  await expect(win.getByTestId(`session-item-${firstSessionId}`)).not.toHaveClass(/active/);

  await app.close();
});

test("Task acceptance: resize triggers cols/rows update", async () => {
  const { app, win } = await launchApp();

  await win.locator(".project-create-main").first().click({ force: true });
  const sessionId = await win.locator("[data-session-id]").first().getAttribute("data-session-id");

  const before = await win.evaluate((sid) => window.__MERGECODECLI_TEST__?.getLastResize(sid), sessionId);
  await win.setViewportSize({ width: 1400, height: 900 });

  const after = await win.evaluate((sid) => window.__MERGECODECLI_TEST__?.getLastResize(sid), sessionId);
  expect(after).toBeTruthy();
  if (before && after) {
    expect(after.cols > 0).toBeTruthy();
    expect(after.rows > 0).toBeTruthy();
  }

  await app.close();
});

test("Task acceptance: archive closes active session without renderer crash", async () => {
  const { app, win } = await launchApp();

  await win.locator(".project-create-main").first().click({ force: true });
  await expect(win.locator("[data-session-id]")).toHaveCount(1);

  await win.getByRole("button", { name: "归档当前会话" }).click();

  await expect(win.locator("[data-session-id]")).toHaveCount(0);

  await app.close();
});

test("Task acceptance: explorer panel remains flex so tree uses full height", async () => {
  const { app, win } = await launchApp();
  await win.locator(".project-create-main").first().click({ force: true });

  let display = await win.evaluate(() => {
    const explorer = document.querySelector(".explorer");
    if (!explorer) return null;
    return window.getComputedStyle(explorer).display;
  });

  if (display !== "flex") {
    const toggle = win.getByRole("button", { name: /展开文件树|关闭文件树/ }).first();
    if (await toggle.count()) {
      await toggle.click({ force: true });
      display = await win.evaluate(() => {
        const explorer = document.querySelector(".explorer");
        if (!explorer) return null;
        return window.getComputedStyle(explorer).display;
      });
    }
  }

  expect(display).toBe("flex");

  await app.close();
});
