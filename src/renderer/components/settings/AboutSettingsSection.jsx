import React from "react";
import { ExternalLinkIcon } from "../../icons/icon-registry";

export function AboutSettingsSection({ appVersion, appLogo }) {
  return (
    <div className="settings-form about-page">
      <div className="about-header">
        <div className="about-icon-wrap">
          <img src={appLogo} alt="" className="about-header-logo" aria-hidden="true" />
        </div>
        <div className="about-title-block">
          <div className="about-title">关于</div>
          <div className="about-subtitle">查看应用版本、版权与项目联系信息。</div>
        </div>
        <div className="about-version-badge">
          <span className="about-version-dot" aria-hidden="true" />
          <span className="about-version-text">v{appVersion}</span>
        </div>
      </div>

      <div className="about-divider" />

      <div className="about-body">
        <div className="about-summary-card">
          <div className="about-summary-title">MergeCodeCli Docs</div>
          <div className="about-summary-desc">用于管理 AI 编程工具配置、环境变量与本地文档的设置中心。</div>
        </div>

        <div className="about-info-card">
          <div className="about-info-row">
            <div className="about-info-label">版本</div>
            <div className="about-info-value">{appVersion}</div>
          </div>
          <div className="about-info-divider" />
          <div className="about-info-row">
            <div className="about-info-label">版权</div>
            <div className="about-info-value">Copyright © 2026 MergeCodeCli All rights reserved.</div>
          </div>
          <div className="about-info-divider" />
          <div className="about-info-row">
            <div className="about-info-label">联系人</div>
            <div className="about-info-value">MergeCodeCli</div>
          </div>
          <div className="about-info-divider" />
          <div className="about-info-row">
            <div className="about-info-label">联系邮箱</div>
            <div className="about-info-value">g_2007@qq.com</div>
          </div>
          <div className="about-info-divider" />
          <div className="about-info-row">
            <div className="about-info-label">项目来源</div>
            <div className="about-info-value">MergeCodeCli</div>
          </div>
        </div>

        <div className="about-source-panel">
          <div className="about-source-title-row">
            <span className="about-source-icon-wrap" aria-hidden="true">
              <ExternalLinkIcon size={16} className="about-source-icon" />
            </span>
            <span className="about-source-title">项目来源说明</span>
          </div>
          <div className="about-source-desc">
            项目来自@MergeCodeCli 原创设计 @2026 用于集中维护模型工具配置、归档与外观选项。
          </div>
          <div className="about-meta-strip">
            <span className="about-foot-path">MergeCodeCli</span>
            <span className="about-foot-tag">内部使用</span>
          </div>
        </div>
      </div>
    </div>
  );
}
