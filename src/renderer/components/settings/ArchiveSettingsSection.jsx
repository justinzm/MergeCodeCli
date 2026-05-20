import React from "react";

export function ArchiveSettingsSection({ archivedSessions, providerLabel, onRestoreArchivedSession }) {
  return (
    <div className="settings-form">
      <h3>Archived Sessions</h3>
      {archivedSessions.length === 0 ? (
        <div className="settings-coming-soon">暂无已归档会话。</div>
      ) : (
        <div className="archived-list">
          {archivedSessions.map((item) => (
            <div key={item.archiveId || `${item.provider}:${item.sessionId}`} className="archived-row">
              <div className="archived-meta">
                <div className="archived-name">{item.name} · {providerLabel[item.provider] || item.provider}</div>
                <div className="archived-cwd">{item.cwd}</div>
              </div>
              <button type="button" onClick={() => onRestoreArchivedSession(item.archiveId || item.sessionId)}>
                恢复
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
