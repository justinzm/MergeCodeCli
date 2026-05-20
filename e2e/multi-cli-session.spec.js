const { test, expect } = require("@playwright/test");
const { _electron: electron } = require("playwright");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
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
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_archives (
      session_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'claude',
      project_id TEXT,
      title TEXT,
      cwd TEXT NOT NULL,
      archived_at TEXT NOT NULL,
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

function seedProviderSessions(homeDir, projectDir) {
  const claudeSid = "11111111-1111-4111-8111-111111111111";
  const codexSid = "22222222-2222-4222-8222-222222222222";
  const geminiSid = "33333333-3333-4333-8333-333333333333";
  const claudeSubAgentSid = "agent-a1111111111111111";

  const claudePath = path.join(homeDir, ".claude", "projects", "demo", `${claudeSid}.jsonl`);
  ensureDir(path.dirname(claudePath));
  fs.writeFileSync(
    claudePath,
    `${JSON.stringify({ cwd: projectDir, message: { role: "user", content: "claude-provider-session" } })}\n`,
    "utf8"
  );
  const claudeSubAgentPath = path.join(
    homeDir,
    ".claude",
    "projects",
    "demo",
    claudeSid,
    "subagents",
    `${claudeSubAgentSid}.jsonl`
  );
  ensureDir(path.dirname(claudeSubAgentPath));
  fs.writeFileSync(
    claudeSubAgentPath,
    `${JSON.stringify({ cwd: projectDir, message: { role: "user", content: "claude-subagent-session" } })}\n`,
    "utf8"
  );

  const codexPath = path.join(homeDir, ".codex", "sessions", "demo", `${codexSid}.jsonl`);
  ensureDir(path.dirname(codexPath));
  fs.writeFileSync(
    codexPath,
    `${JSON.stringify({ cwd: projectDir, message: { role: "user", content: "codex-provider-session" } })}\n`,
    "utf8"
  );
  const codexDuplicatePath = path.join(homeDir, ".codex", "sessions", "demo", "nested", `${codexSid}.jsonl`);
  ensureDir(path.dirname(codexDuplicatePath));
  fs.writeFileSync(
    codexDuplicatePath,
    `${JSON.stringify({ cwd: projectDir, message: { role: "user", content: "codex-provider-session" } })}\n`,
    "utf8"
  );

  const geminiPath = path.join(homeDir, ".gemini", "tmp", "demo", "chats", `${geminiSid}.json`);
  ensureDir(path.dirname(geminiPath));
  fs.writeFileSync(
    geminiPath,
    JSON.stringify({
      cwd: projectDir,
      messages: [{ role: "user", text: "gemini-provider-session" }]
    }),
    "utf8"
  );

  return { claudeSid, codexSid, geminiSid, claudeSubAgentSid };
}

async function launchAppWithFixtures() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mergecodecli-multi-cli-"));
  const dbPath = path.join(root, "e2e.db");
  const projectDir = path.join(root, "project-a");
  ensureDir(projectDir);
  setupDb(dbPath, projectDir);
  const ids = seedProviderSessions(root, projectDir);

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
  return { app, win, ids };
}

async function syncFirstProjectHistory(win) {
  await win.locator(".project-create-toggle").first().click({ force: true });
  await win.getByRole("button", { name: "读取历史会话" }).click({ force: true });
}

function countOccurrences(text, token) {
  if (!token) return 0;
  return String(text || "").split(token).length - 1;
}

test("multi provider sessions are discovered and resumed by provider", async () => {
  const { app, win, ids } = await launchAppWithFixtures();
  await syncFirstProjectHistory(win);

  await expect(win.getByTestId(`session-item-${ids.claudeSid}`)).toBeVisible();
  await expect(win.getByTestId(`session-item-${ids.codexSid}`)).toBeVisible();
  await expect(win.getByTestId(`session-item-${ids.geminiSid}`)).toBeVisible();
  await expect(win.getByTestId(`session-item-${ids.codexSid}`)).toHaveCount(1);
  await expect(win.getByTestId(`session-item-${ids.claudeSubAgentSid}`)).toHaveCount(0);

  await win.getByTestId(`session-item-${ids.codexSid}`).click();
  await expect(win.locator(".toolbar-provider-icon[title='Codex CLI']")).toBeVisible();
  await expect(win.locator(".status-chip")).toBeVisible();
  await expect(win.locator(`[data-session-id="${ids.codexSid}"]`)).toBeVisible();

  await win.getByTestId(`session-item-${ids.geminiSid}`).click();
  await expect(win.locator(".toolbar-provider-icon[title='Gemini CLI']")).toBeVisible();
  await expect(win.locator(".status-chip")).toBeVisible();
  await expect(win.locator(`[data-session-id="${ids.geminiSid}"]`)).toBeVisible();

  await app.close();
});

test("archive and restore uses provider+session archive id", async () => {
  const { app, win } = await launchAppWithFixtures();
  await syncFirstProjectHistory(win);

  const codexItem = win.getByTestId("session-item-22222222-2222-4222-8222-222222222222");
  await expect(codexItem).toBeVisible();
  await codexItem.locator(".session-archive-btn").click({ force: true });

  await expect(win.getByTestId("session-item-22222222-2222-4222-8222-222222222222")).toHaveCount(0);
  await expect(win.getByTestId("session-item-11111111-1111-4111-8111-111111111111")).toBeVisible();
  await expect(win.getByTestId("session-item-33333333-3333-4333-8333-333333333333")).toBeVisible();

  await win.getByRole("button", { name: "Settings" }).click();
  await win.locator(".settings-modal").getByRole("button", { name: "Archive" }).click();

  const archivedRow = win.locator(".archived-row", { hasText: "codex-provider-session" });
  await expect(archivedRow).toBeVisible();
  await archivedRow.getByRole("button", { name: "恢复" }).click();
  await win.locator(".settings-close").click();

  await expect(win.getByTestId("session-item-22222222-2222-4222-8222-222222222222")).toBeVisible();

  await app.close();
});

test("switching back and forth does not inject duplicate resume commands", async () => {
  const { app, win, ids } = await launchAppWithFixtures();
  await syncFirstProjectHistory(win);

  const codexItem = win.getByTestId(`session-item-${ids.codexSid}`);
  const claudeItem = win.getByTestId(`session-item-${ids.claudeSid}`);
  const geminiItem = win.getByTestId(`session-item-${ids.geminiSid}`);

  await codexItem.click();
  await claudeItem.click();
  await codexItem.click();
  await geminiItem.click();
  await codexItem.click();

  const buffer = await win.evaluate((sid) => window.__MERGECODECLI_TEST__?.getSessionBuffer(sid) || "", ids.codexSid);
  const launchToken = "ELECTRON_RUN_AS_NODE=1";
  expect(countOccurrences(buffer, launchToken)).toBeLessThanOrEqual(1);

  await app.close();
});
