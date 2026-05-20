"use strict";

const DB_MODELS = {
  projects: {
    tableName: "projects",
    description: "工作区项目",
    columns: [
      { name: "id", type: "TEXT", primaryKey: true, description: "项目主键 ID（UUID）" },
      { name: "name", type: "TEXT", notNull: true, description: "项目显示名称" },
      { name: "path", type: "TEXT", notNull: true, unique: true, description: "项目绝对路径（工作目录）" },
      { name: "default_provider", type: "TEXT", notNull: true, default: "'claude'", description: "项目默认 CLI 提供商" },
      { name: "created_at", type: "TEXT", notNull: true, description: "创建时间（ISO 字符串）" },
      { name: "updated_at", type: "TEXT", notNull: true, description: "最后更新时间（ISO 字符串）" }
    ]
  },
  sessions: {
    tableName: "sessions",
    description: "会话与运行状态",
    columns: [
      { name: "id", type: "TEXT", primaryKey: true, description: "会话记录主键 ID（UUID）" },
      { name: "project_id", type: "TEXT", notNull: true, references: { table: "projects", column: "id" }, description: "所属项目 ID" },
      { name: "title", type: "TEXT", notNull: true, description: "会话标题（展示名）" },
      { name: "provider", type: "TEXT", notNull: true, description: "会话来源 CLI（claude/codex/gemini）" },
      { name: "provider_session_id", type: "TEXT", notNull: true, description: "CLI 原生会话 ID（与 provider 组成唯一键）" },
      { name: "cwd", type: "TEXT", notNull: true, default: "''", description: "兼容字段：历史会话工作目录（当前以 project.path 为准）" },
      { name: "session_file_path", type: "TEXT", description: "会话实体文件路径（如 *.jsonl/*.json）" },
      { name: "status", type: "TEXT", notNull: true, description: "当前状态（idle/running/exited）" },
      { name: "sort_order", type: "INTEGER", notNull: true, default: 0, description: "会话手动排序权重（同项目内越大越靠前）" },
      { name: "last_active_at", type: "TEXT", notNull: true, description: "最近活跃时间（ISO 字符串）" },
      { name: "created_at", type: "TEXT", notNull: true, description: "创建时间（ISO 字符串）" },
      { name: "updated_at", type: "TEXT", notNull: true, description: "最后更新时间（ISO 字符串）" },
      { name: "is_archived", type: "INTEGER", notNull: true, default: 0, description: "是否已归档（0=否，1=是）" },
      { name: "archived_at", type: "TEXT", description: "归档时间（ISO 字符串）" }
    ],
    indexes: [
      { name: "idx_sessions_project", columns: ["project_id"] },
      { name: "idx_sessions_provider_sid_unique", columns: ["provider", "provider_session_id"], unique: true }
    ]
  },
  appSettings: {
    tableName: "app_settings",
    description: "应用设置键值",
    columns: [
      { name: "key", type: "TEXT", primaryKey: true, description: "设置项键名" },
      { name: "value", type: "TEXT", notNull: true, description: "设置项值（JSON 字符串）" },
      { name: "updated_at", type: "TEXT", notNull: true, description: "最后更新时间（ISO 字符串）" }
    ]
  }
};

function buildColumnSql(column) {
  const parts = [column.name, column.type];
  if (column.primaryKey) parts.push("PRIMARY KEY");
  if (column.notNull) parts.push("NOT NULL");
  if (column.unique) parts.push("UNIQUE");
  if (Object.prototype.hasOwnProperty.call(column, "default")) {
    parts.push(`DEFAULT ${column.default}`);
  }
  return parts.join(" ");
}

function buildCreateTableSql(model) {
  const columnSqlList = model.columns.map(buildColumnSql);
  const foreignKeys = model.columns
    .filter((column) => column.references)
    .map((column) => `FOREIGN KEY(${column.name}) REFERENCES ${column.references.table}(${column.references.column})`);
  const allDefinitions = [...columnSqlList, ...foreignKeys].join(",\n      ");
  return `CREATE TABLE IF NOT EXISTS ${model.tableName} (\n      ${allDefinitions}\n    );`;
}

function buildCreateIndexSql(model) {
  return (model.indexes || []).map((index) => {
    const columns = index.columns.join(", ");
    const kind = index.unique ? "UNIQUE INDEX" : "INDEX";
    return `CREATE ${kind} IF NOT EXISTS ${index.name} ON ${model.tableName}(${columns});`;
  });
}

function buildSchemaSql() {
  const statements = [];
  for (const model of Object.values(DB_MODELS)) {
    statements.push(buildCreateTableSql(model));
    statements.push(...buildCreateIndexSql(model));
  }
  return statements.join("\n\n");
}

function getModelByTableName(tableName) {
  return Object.values(DB_MODELS).find((model) => model.tableName === tableName) || null;
}

module.exports = {
  DB_MODELS,
  buildSchemaSql,
  getModelByTableName
};
