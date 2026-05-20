const { test, expect } = require("@playwright/test");
const { _electron: electron } = require("playwright");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const http = require("node:http");
const { DatabaseSync } = require("node:sqlite");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setupDb(dbPath, projectDir, providerSettings) {
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

  if (providerSettings) {
    db.prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, ?)`
    ).run("provider_startup_settings", JSON.stringify(providerSettings), now);
  }

  db.close();
}

async function launchAppWithFixtures(providerSettings) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mergecodecli-settings-"));
  const dbPath = path.join(root, "e2e.db");
  const projectDir = path.join(root, "project-a");
  ensureDir(projectDir);
  setupDb(dbPath, projectDir, providerSettings);

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

  const win = await findMainWindow(app);
  return { app, win };
}

async function findMainWindow(app, timeoutMs = 90000) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const windows = app.windows();
    for (const win of windows) {
      try {
        await win.waitForLoadState("domcontentloaded", { timeout: 1500 });
        const settingsCount = await win.getByRole("button", { name: /Settings|设置/i }).count();
        if (settingsCount > 0) return win;
      } catch {}
    }
    await sleep(250);
  }
  throw new Error("Main window with Settings button not found within timeout");
}

async function openProviderSettings(win) {
  const settingsButton = win.getByRole("button", { name: /Settings|设置/i }).first();
  await expect(settingsButton).toBeVisible({ timeout: 60000 });
  await settingsButton.click();
  await expect(win.locator(".settings-modal")).toBeVisible();
  await expect(win.getByRole("heading", { name: "Model Provider Settings" })).toBeVisible();
}

async function invokeProviderTest(win, payload) {
  return win.evaluate(async (input) => window.electronAPI.settings.testProvider(input), payload);
}

test("claude preset list shows DeepSeek profile and related env rows", async () => {
  const { app, win } = await launchAppWithFixtures();

  await openProviderSettings(win);

  const profileSelect = win.locator(".provider-profile-select-row select");
  await expect(win.locator(".provider-profile-select-row select option[value='deepseek-api']")).toHaveCount(1);

  await profileSelect.selectOption("deepseek-api");

  await expect(profileSelect).toHaveValue("deepseek-api");
  await expect(win.locator('input.env-key[value="ANTHROPIC_API_KEY"]')).toHaveCount(1);
  await expect(win.locator('input.env-key[value="ANTHROPIC_BASE_URL"]')).toHaveCount(1);
  await expect(win.locator('input.env-value[value="https://api.deepseek.com/anthropic"]')).toHaveCount(1);

  await app.close();
});

test("provider tabs default to each provider enabled profile from saved settings", async () => {
  const seededSettings = {
    providers: {
      claude: {
        defaultProfileId: "kimi-code-plan",
        enabledProfileId: "deepseek-api",
        profiles: [
          { id: "kimi-code-plan", name: "Kimi Code Plan", envVars: [] },
          { id: "deepseek-api", name: "DeepSeek API", envVars: [] }
        ]
      },
      codex: {
        defaultProfileId: "openai-api-key",
        enabledProfileId: "oauth-login",
        profiles: [
          { id: "openai-api-key", name: "OpenAI API Key", envVars: [] },
          { id: "oauth-login", name: "OAuth 登录", envVars: [] }
        ]
      },
      gemini: {
        defaultProfileId: "api-key",
        enabledProfileId: "oauth-login",
        profiles: [
          { id: "api-key", name: "API Key", envVars: [] },
          { id: "oauth-login", name: "OAuth 登录", envVars: [] }
        ]
      }
    }
  };

  const { app, win } = await launchAppWithFixtures(seededSettings);

  await openProviderSettings(win);

  const profileSelect = win.locator(".provider-profile-select-row select");

  await expect(profileSelect).toHaveValue("deepseek-api");
  await expect(win.locator(".provider-profile-select-row .provider-enabled-tag")).toHaveText("已启用");

  await win.getByRole("button", { name: "Codex CLI" }).click();
  await expect(profileSelect).toHaveValue("oauth-login");
  await expect(win.locator(".provider-profile-select-row .provider-enabled-tag")).toHaveText("已启用");

  await win.getByRole("button", { name: "Gemini CLI" }).click();
  await expect(profileSelect).toHaveValue("oauth-login");
  await expect(win.locator(".provider-profile-select-row .provider-enabled-tag")).toHaveText("已启用");

  await app.close();
});

test("gemini oauth shows step-1 only before auth url and save feedback works", async () => {
  const { app, win } = await launchAppWithFixtures();

  await openProviderSettings(win);

  await win.getByRole("button", { name: "Gemini CLI" }).click();
  const profileSelect = win.locator(".provider-profile-select-row select");
  await profileSelect.selectOption("oauth-login");

  await expect(win.locator(".oauth-panel-title")).toHaveText("使用 CLI OAuth 登录");
  await expect(win.getByText("一、Google OAuth 鉴权")).toHaveCount(0);
  await expect(win.getByText("二、填写 Google OAuth 验证码")).toHaveCount(0);

  await win.getByRole("button", { name: "保存" }).click();
  await expect(win.locator(".provider-save-success")).toHaveText("已保存");

  await app.close();
});

test("about section shows contact email and version info", async () => {
  const { app, win } = await launchAppWithFixtures();

  await win.getByRole("button", { name: "Settings" }).click();
  await win.getByRole("button", { name: "关于" }).click();

  await expect(win.getByText("查看应用版本、版权与项目联系信息。")).toBeVisible();
  await expect(win.getByText("g_2007@qq.com")).toBeVisible();
  await expect(win.locator(".about-version-text")).toContainText("v0.1.0");

  await app.close();
});

test("settings archive and appearance sections can be opened", async () => {
  const { app, win } = await launchAppWithFixtures();

  await win.getByRole("button", { name: "Settings" }).click();

  await win.getByRole("button", { name: "Archive" }).click();
  await expect(win.getByRole("heading", { name: "Archived Sessions" })).toBeVisible();
  await expect(win.getByText("暂无已归档会话。")).toBeVisible();

  await win.getByRole("button", { name: "Appearance" }).click();
  await expect(win.getByRole("heading", { name: "Appearance" })).toBeVisible();
  await expect(win.getByText("外观主题设置将在下一步接入。")).toBeVisible();

  await app.close();
});

test("claude deepseek profile requires at least one anthropic credential", async () => {
  const { app, win } = await launchAppWithFixtures();

  const result = await invokeProviderTest(win, {
    provider: "claude",
    profileId: "deepseek-api",
    envVars: []
  });

  expect(result.ok).toBeFalsy();
  expect(String(result.message || "")).toContain("DeepSeek 需要配置 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN");

  await app.close();
});

test("claude non-deepseek test accepts ANTHROPIC_AUTH_TOKEN", async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      authorization: String(req.headers.authorization || ""),
      apiKey: String(req.headers["x-api-key"] || "")
    });
    if (req.method === "GET" && req.url === "/v1/models" && /^Bearer\s+sk-auth-token-only$/i.test(String(req.headers.authorization || ""))) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "fake-model" }] }));
      return;
    }
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;
    const { app, win } = await launchAppWithFixtures();

    const result = await invokeProviderTest(win, {
      provider: "claude",
      profileId: "default",
      envVars: [
        { key: "ANTHROPIC_AUTH_TOKEN", value: "sk-auth-token-only" },
        { key: "ANTHROPIC_BASE_URL", value: baseUrl }
      ]
    });

    expect(result.ok).toBeTruthy();
    expect(String(result.message || "")).toContain("Claude 连接成功");
    expect(requests.some((item) => item.method === "GET" && item.url === "/v1/models")).toBeTruthy();
    expect(requests.some((item) => /^Bearer\s+sk-auth-token-only$/i.test(item.authorization))).toBeTruthy();
    expect(requests.every((item) => !String(item.apiKey || "").trim())).toBeTruthy();

    await app.close();
  } finally {
    server.close();
  }
});
