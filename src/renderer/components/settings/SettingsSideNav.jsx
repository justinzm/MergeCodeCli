import React from "react";

export function SettingsSideNav({ settingsSection, onSelectProviders, onSelectArchive, onSelectAppearance, onSelectAbout }) {
  return (
    <div className="settings-side-nav">
      <button
        type="button"
        className={settingsSection === "providers" ? "active" : ""}
        onClick={onSelectProviders}
      >
        Providers
      </button>
      <button
        type="button"
        className={settingsSection === "archive" ? "active" : ""}
        onClick={onSelectArchive}
      >
        Archive
      </button>
      <button
        type="button"
        className={settingsSection === "appearance" ? "active" : ""}
        onClick={onSelectAppearance}
      >
        Appearance
      </button>
      <button
        type="button"
        className={settingsSection === "about" ? "active" : ""}
        onClick={onSelectAbout}
      >
        <span className="about-nav-item">
          <span className="about-nav-icon" aria-hidden="true">i</span>
          <span>关于</span>
        </span>
      </button>
    </div>
  );
}
