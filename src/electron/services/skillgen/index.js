"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function openStateDb(workspacePath) {
  const skillgenRoot = path.join(workspacePath, ".claude", ".skillgen");
  const runLogsDir = path.join(skillgenRoot, "run_logs");
  const candidatesDir = path.join(skillgenRoot, "candidates");
  ensureDir(skillgenRoot);
  ensureDir(runLogsDir);
  ensureDir(candidatesDir);

  const dbPath = path.join(skillgenRoot, "state.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS processed_files (
      project_id TEXT NOT NULL,
      session_file_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(project_id, session_file_path)
    );
  `);

  return {
    db,
    dbPath,
    runLogsDir,
    candidatesDir,
    getHash(projectId, sessionFilePath) {
      const row = db.prepare(
        "SELECT content_hash FROM processed_files WHERE project_id = ? AND session_file_path = ?"
      ).get(projectId, sessionFilePath);
      return row?.content_hash || "";
    },
    upsertHash(projectId, sessionFilePath, contentHash) {
      db.prepare(
        `INSERT INTO processed_files (project_id, session_file_path, content_hash, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id, session_file_path) DO UPDATE SET
           content_hash = excluded.content_hash,
           updated_at = excluded.updated_at`
      ).run(projectId, sessionFilePath, contentHash, new Date().toISOString());
    },
    close() {
      db.close();
    }
  };
}

module.exports = {
  openStateDb
};

