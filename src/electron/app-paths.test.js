const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  resolveAppDataPaths,
  migrateLegacyAppData
} = require("./app-paths");

const BASE_CONFIG = {
  appId: "mergecodecli",
  legacyAppId: "zeelincode",
  dbFilename: "mergecodecli.sqlite",
  legacyDbFilename: "zeelincode.sqlite"
};

function setupHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mergecodecli-app-paths-"));
}

test("resolveAppDataPaths uses the MergeCodeCli app id and database filename", () => {
  const homeDir = setupHome();
  const paths = resolveAppDataPaths({
    ...BASE_CONFIG,
    homeDir,
    isDev: false,
    env: {}
  });

  assert.equal(paths.runtimeAppId, "mergecodecli");
  assert.equal(paths.appHomeDir, path.join(homeDir, ".mergecodecli"));
  assert.equal(paths.dbPath, path.join(homeDir, ".mergecodecli", "mergecodecli.sqlite"));
  assert.equal(paths.dbPathSource, "default");
});

test("resolveAppDataPaths prefers the new database path env var over the legacy one", () => {
  const homeDir = setupHome();
  const paths = resolveAppDataPaths({
    ...BASE_CONFIG,
    homeDir,
    isDev: true,
    env: {
      MERGECODECLI_DB_PATH: "/tmp/new.sqlite",
      ZEELIN_DB_PATH: "/tmp/legacy.sqlite"
    }
  });

  assert.equal(paths.runtimeAppId, "mergecodeclidev");
  assert.equal(paths.dbPath, "/tmp/new.sqlite");
  assert.equal(paths.dbPathSource, "env");
});

test("resolveAppDataPaths keeps ZEELIN_DB_PATH as a legacy database path fallback", () => {
  const homeDir = setupHome();
  const paths = resolveAppDataPaths({
    ...BASE_CONFIG,
    homeDir,
    isDev: false,
    env: {
      ZEELIN_DB_PATH: "/tmp/legacy.sqlite"
    }
  });

  assert.equal(paths.dbPath, "/tmp/legacy.sqlite");
  assert.equal(paths.dbPathSource, "legacyEnv");
});

test("migrateLegacyAppData copies the legacy database into the new app data directory", () => {
  const homeDir = setupHome();
  const legacyDir = path.join(homeDir, ".zeelincode");
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, "zeelincode.sqlite"), "legacy-db");
  fs.writeFileSync(path.join(legacyDir, "settings.json"), "legacy-settings");

  const paths = resolveAppDataPaths({
    ...BASE_CONFIG,
    homeDir,
    isDev: false,
    env: {}
  });

  const result = migrateLegacyAppData(paths);

  assert.equal(result.copiedLegacyHome, true);
  assert.equal(result.copiedLegacyDatabase, true);
  assert.equal(fs.readFileSync(path.join(paths.appHomeDir, "settings.json"), "utf8"), "legacy-settings");
  assert.equal(fs.readFileSync(path.join(paths.appHomeDir, "mergecodecli.sqlite"), "utf8"), "legacy-db");
});
