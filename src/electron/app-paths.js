const fs = require("node:fs");
const path = require("node:path");

const DB_ENV_KEY = "MERGECODECLI_DB_PATH";
const LEGACY_DB_ENV_KEY = "ZEELIN_DB_PATH";

function ensureDirSafe(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resolveRuntimeAppId(appId, isDev) {
  const id = String(appId || "").trim();
  return isDev ? `${id}dev` : id;
}

function resolveAppDataPaths({
  homeDir,
  appId,
  legacyAppId,
  dbFilename,
  legacyDbFilename,
  isDev,
  env = process.env
}) {
  const runtimeAppId = resolveRuntimeAppId(appId, isDev);
  const legacyRuntimeAppId = legacyAppId ? resolveRuntimeAppId(legacyAppId, isDev) : "";
  const appHomeDir = path.join(homeDir, `.${runtimeAppId}`);
  const legacyAppHomeDir = legacyRuntimeAppId ? path.join(homeDir, `.${legacyRuntimeAppId}`) : "";
  const appLogsDir = path.join(appHomeDir, "logs");
  const appCacheDir = path.join(appHomeDir, "cache");

  const newEnvDbPath = String(env?.[DB_ENV_KEY] || "").trim();
  const legacyEnvDbPath = String(env?.[LEGACY_DB_ENV_KEY] || "").trim();
  const dbPath = newEnvDbPath || legacyEnvDbPath || path.join(appHomeDir, dbFilename);
  const dbPathSource = newEnvDbPath ? "env" : (legacyEnvDbPath ? "legacyEnv" : "default");

  return {
    runtimeAppId,
    legacyRuntimeAppId,
    appHomeDir,
    legacyAppHomeDir,
    appLogsDir,
    appCacheDir,
    dbFilename,
    legacyDbFilename,
    dbPath,
    dbPathSource
  };
}

function copyIfExists(source, target) {
  if (!source || !target || !fs.existsSync(source) || fs.existsSync(target)) return false;
  ensureDirSafe(path.dirname(target));
  fs.copyFileSync(source, target);
  return true;
}

function copyLegacyDatabaseIfMissing(paths) {
  const copied = [];
  const candidates = [
    path.join(paths.appHomeDir, paths.legacyDbFilename || ""),
    paths.legacyAppHomeDir ? path.join(paths.legacyAppHomeDir, paths.legacyDbFilename || "") : ""
  ].filter(Boolean);

  for (const legacyDbPath of candidates) {
    const targetDbPath = path.join(paths.appHomeDir, paths.dbFilename);
    if (!fs.existsSync(legacyDbPath) || fs.existsSync(targetDbPath)) continue;
    for (const suffix of ["", "-wal", "-shm"]) {
      const source = `${legacyDbPath}${suffix}`;
      const target = `${targetDbPath}${suffix}`;
      if (copyIfExists(source, target)) copied.push(target);
    }
    break;
  }

  return copied;
}

function migrateLegacyAppData(paths) {
  const result = {
    copiedLegacyHome: false,
    copiedLegacyDatabase: false,
    errors: []
  };

  if (!paths?.appHomeDir) return result;

  try {
    if (
      paths.legacyAppHomeDir
      && paths.legacyAppHomeDir !== paths.appHomeDir
      && fs.existsSync(paths.legacyAppHomeDir)
      && !fs.existsSync(paths.appHomeDir)
    ) {
      fs.cpSync(paths.legacyAppHomeDir, paths.appHomeDir, { recursive: true });
      result.copiedLegacyHome = true;
    }
  } catch (error) {
    result.errors.push(error);
  }

  try {
    const copiedDatabaseFiles = copyLegacyDatabaseIfMissing(paths);
    result.copiedLegacyDatabase = copiedDatabaseFiles.length > 0;
  } catch (error) {
    result.errors.push(error);
  }

  return result;
}

function configureAppDataPaths(app, paths) {
  ensureDirSafe(paths.appHomeDir);
  ensureDirSafe(paths.appLogsDir);
  ensureDirSafe(paths.appCacheDir);

  app.setPath("userData", paths.appHomeDir);
  try {
    app.setAppLogsPath(paths.appLogsDir);
  } catch {}
  try {
    app.setPath("logs", paths.appLogsDir);
  } catch {}
  try {
    app.setPath("sessionData", paths.appCacheDir);
  } catch {}
  try {
    app.setPath("cache", paths.appCacheDir);
  } catch {}
}

module.exports = {
  DB_ENV_KEY,
  LEGACY_DB_ENV_KEY,
  resolveAppDataPaths,
  migrateLegacyAppData,
  configureAppDataPaths
};
