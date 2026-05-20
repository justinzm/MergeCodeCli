import React from "react";

export function ProviderSettingsSection({
  providerTab,
  setProviderTab,
  currentProviderSettings,
  isFixedProfileProvider,
  addProviderProfile,
  editingProfile,
  onSelectEditingProfile,
  onSelectProfileItem,
  renameProviderProfile,
  setDefaultProviderProfile,
  removeProviderProfile,
  currentProviderTestState,
  isEditingOAuthProfile,
  oauthProviderHint,
  oauthCommandHint,
  onStartOAuthLogin,
  hasCurrentOauthDisplayUrl,
  currentOauthDisplayUrl,
  openOAuthLink,
  currentOauthCode,
  onOauthCodeChange,
  submitOAuthCode,
  regularEnvVars,
  updateEnvVar,
  removeEnvVar,
  addEnvVar,
  onToggleProviderProfile,
  currentProxyTestState,
  proxyState,
  setProxyConfig,
  onToggleProxyEnabled,
  settingsSavedAt,
  onSaveSettings,
  settingsError
}) {
  return (
    <div className="settings-form">
      <h3>Model Provider Settings</h3>
      <div className="provider-tabs">
        <button
          type="button"
          className={providerTab === "claude" ? "active" : ""}
          onClick={() => setProviderTab("claude")}
        >
          Claude Code
        </button>
        <button
          type="button"
          className={providerTab === "codex" ? "active" : ""}
          onClick={() => setProviderTab("codex")}
        >
          Codex CLI
        </button>
        <button
          type="button"
          className={providerTab === "gemini" ? "active" : ""}
          onClick={() => setProviderTab("gemini")}
        >
          Gemini CLI
        </button>
      </div>

      <>
        <div className="provider-content-box">
          <div className={`provider-profiles-head ${!isFixedProfileProvider ? "provider-profiles-head-with-action" : ""}`}>
            <span>{isFixedProfileProvider ? "供应商预设" : "供应商配置组"}</span>
            {!isFixedProfileProvider && (
              <button type="button" onClick={addProviderProfile}>+ 新增供应商</button>
            )}
          </div>

          {editingProfile && (
            <div className="provider-profile-editor">
              <div className="provider-profiles">
                {isFixedProfileProvider ? (
                  <div className="provider-profile-select-row">
                    <select
                      value={editingProfile?.id || ""}
                      onChange={(e) => onSelectEditingProfile(e.target.value)}
                    >
                      {(currentProviderSettings.profiles || []).map((profile) => (
                        <option key={profile.id} value={profile.id}>{profile.name}</option>
                      ))}
                    </select>
                    {editingProfile && currentProviderSettings.enabledProfileId === editingProfile.id && (
                      <span className="provider-enabled-tag">已启用</span>
                    )}
                  </div>
                ) : (
                  <div className="provider-profiles-list">
                    {(currentProviderSettings.profiles || []).map((profile) => (
                      <button
                        key={profile.id}
                        type="button"
                        className={`provider-profile-item ${profile.id === editingProfile?.id ? "active" : ""}`}
                        onClick={() => onSelectProfileItem(profile.id)}
                      >
                        <span className="provider-profile-name">{profile.name}</span>
                        {currentProviderSettings.defaultProfileId === profile.id && (
                          <span className="provider-default-tag">默认</span>
                        )}
                        {currentProviderSettings.enabledProfileId === profile.id && (
                          <span className="provider-enabled-tag">已启用</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {!isFixedProfileProvider && (
                <div className="provider-profile-controls">
                  <input
                    type="text"
                    value={editingProfile.name}
                    onChange={(e) => renameProviderProfile(editingProfile.id, e.target.value)}
                    placeholder="供应商名称"
                  />
                  <button
                    type="button"
                    onClick={() => setDefaultProviderProfile(editingProfile.id)}
                    disabled={currentProviderSettings.defaultProfileId === editingProfile.id}
                  >
                    设为默认
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => removeProviderProfile(editingProfile.id)}
                    disabled={(currentProviderSettings.profiles || []).length <= 1}
                  >
                    删除供应商
                  </button>
                </div>
              )}
              {currentProviderTestState.message && (
                <div className={`provider-test-message ${currentProviderTestState.status}`}>
                  {currentProviderTestState.message}
                </div>
              )}

              <div className="env-list">
                <div className="env-list-header">
                  <span>{isEditingOAuthProfile ? "OAuth 登录" : "环境变量（预设值只读；支持新增自定义 Key/Value）"}</span>
                </div>

                {isEditingOAuthProfile ? (
                  <div className="oauth-panel">
                    <div className="oauth-panel-title">使用 CLI OAuth 登录</div>
                    <div className="oauth-panel-desc">{oauthProviderHint(providerTab)}</div>
                    {providerTab !== "gemini" && (
                      <div className="oauth-command-row">
                        <span className="oauth-command-label">启动命令</span>
                        <code className="oauth-command-code">{oauthCommandHint[providerTab]}</code>
                      </div>
                    )}
                    <div className="oauth-action-row">
                      <button
                        type="button"
                        className="oauth-login-btn"
                        onClick={() => onStartOAuthLogin(editingProfile.id)}
                        disabled={currentProviderTestState.status === "testing"}
                      >
                        获取OAuth登陆链接
                      </button>
                    </div>
                    {hasCurrentOauthDisplayUrl && (
                      <div className="oauth-link-panel">
                        <div className="oauth-link-title">一、Google OAuth 鉴权</div>
                        <code className="oauth-link-code">{currentOauthDisplayUrl}</code>
                        <div className="oauth-link-actions">
                          <button
                            type="button"
                            className="oauth-login-btn"
                            onClick={() => openOAuthLink(currentOauthDisplayUrl)}
                          >
                            点击浏览器打开URL
                          </button>
                        </div>
                      </div>
                    )}
                    {providerTab === "gemini" && hasCurrentOauthDisplayUrl && (
                      <div className="oauth-code-panel">
                        <div className="oauth-link-title">二、填写 Google OAuth 验证码</div>
                        <div className="oauth-code-row">
                          <input
                            type="text"
                            className="oauth-code-input"
                            placeholder="粘贴 Gemini 页面显示的 authorization code"
                            value={currentOauthCode}
                            onChange={(e) => onOauthCodeChange(e.target.value)}
                          />
                        </div>
                        <div className="oauth-code-submit-row">
                          <button
                            type="button"
                            className="oauth-login-btn"
                            onClick={() => submitOAuthCode(providerTab, editingProfile.id, currentOauthCode)}
                          >
                            提交验证码
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : regularEnvVars.length === 0 ? (
                  <div className="settings-coming-soon">当前 Provider 暂无预设键名。</div>
                ) : (
                  regularEnvVars.map(({ pair, index }) => (
                    <div className="env-row" key={`${editingProfile.id}-env-${index}`}>
                      <input
                        type="text"
                        placeholder="KEY"
                        value={pair.key}
                        className="env-key"
                        readOnly={!pair.keyEditable}
                        onChange={pair.keyEditable ? (e) => updateEnvVar(index, "key", e.target.value) : undefined}
                      />
                      <input
                        type="text"
                        placeholder="输入值"
                        value={pair.value}
                        className={`env-value ${pair.editable ? "" : "env-value-fixed"}`}
                        readOnly={!pair.editable}
                        onChange={pair.editable ? (e) => updateEnvVar(index, "value", e.target.value) : undefined}
                      />
                      <button
                        type="button"
                        className="env-remove-btn"
                        onClick={() => removeEnvVar(index)}
                        disabled={!pair.removable}
                      >
                        删除
                      </button>
                    </div>
                  ))
                )}
                {!isEditingOAuthProfile && (
                  <div className="env-list-actions">
                    <button type="button" onClick={addEnvVar}>+ 新增变量</button>
                  </div>
                )}
                <div className="env-switch-divider" />
                <label className="provider-enable-row">
                  <span className="provider-enable-text">
                    {isEditingOAuthProfile ? "启用（将执行真实探测）" : "启用（开启时自动测试链接）"}
                  </span>
                  <button
                    type="button"
                    className={`provider-switch ${currentProviderSettings.enabledProfileId === editingProfile.id ? "on" : ""}`}
                    aria-label="启用配置开关"
                    aria-pressed={currentProviderSettings.enabledProfileId === editingProfile.id}
                    onClick={() => onToggleProviderProfile(editingProfile.id, currentProviderSettings.enabledProfileId !== editingProfile.id)}
                    disabled={currentProviderTestState.status === "testing"}
                  >
                    <span className="provider-switch-thumb" />
                  </button>
                </label>
              </div>
            </div>
          )}

          {editingProfile && (
            <div className="proxy-panel provider-proxy-card">
              <div className="proxy-panel-head proxy-panel-head-row">
                <span>代理地址</span>
                <label className="proxy-enable-row">
                  <span className="proxy-enable-text">启用</span>
                  <button
                    type="button"
                    className={`provider-switch ${proxyState.enabled ? "on" : ""}`}
                    aria-label="启用代理开关"
                    aria-pressed={proxyState.enabled}
                    onClick={() => onToggleProxyEnabled(!proxyState.enabled)}
                    disabled={currentProviderTestState.status === "testing" || currentProxyTestState.status === "testing"}
                  >
                    <span className="provider-switch-thumb" />
                  </button>
                </label>
              </div>
              <div className="proxy-empty">启用后会自动写入 HTTP_PROXY 与 HTTPS_PROXY</div>
              <div className="proxy-single-row">
                <input
                  type="text"
                  className="proxy-url-input"
                  placeholder="代理地址，例如 http://127.0.0.1:7890"
                  value={proxyState.url}
                  onChange={(e) => setProxyConfig({ enabled: proxyState.enabled, url: e.target.value })}
                />
              </div>
              {currentProxyTestState.message && (
                <div className={`provider-test-message ${currentProxyTestState.status}`}>
                  {currentProxyTestState.message}
                </div>
              )}
            </div>
          )}

          <div className="provider-content-action-row">
            {settingsSavedAt > 0 && <span className="success provider-save-success">已保存</span>}
            <button type="button" className="apply-btn inline-save-btn" onClick={onSaveSettings}>保存</button>
          </div>
        </div>
        {settingsError && <span className="error">{settingsError}</span>}
      </>
    </div>
  );
}
