import React from "react";
import { AboutSettingsSection } from "./AboutSettingsSection";
import { ArchiveSettingsSection } from "./ArchiveSettingsSection";
import { AppearanceSettingsSection } from "./AppearanceSettingsSection";
import { ProviderSettingsSection } from "./ProviderSettingsSection";
import { SettingsSideNav } from "./SettingsSideNav";

export function SettingsModal({
  settingsOpen,
  onClose,
  settingsSection,
  onSelectProviders,
  onSelectArchive,
  onSelectAppearance,
  onSelectAbout,
  providerSectionProps,
  archivedSessions,
  providerLabel,
  onRestoreArchivedSession,
  appVersion,
  appLogo
}) {
  if (!settingsOpen) return null;

  return (
    <div className="settings-modal-backdrop" data-testid="settings-wrap" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <div>
            <div className="settings-modal-title">Settings</div>
            <div className="settings-modal-subtitle">Configure environments and manage archives.</div>
          </div>
          <button className="settings-close" type="button" onClick={onClose}>×</button>
        </div>

        <div className="settings-modal-body">
          <SettingsSideNav
            settingsSection={settingsSection}
            onSelectProviders={onSelectProviders}
            onSelectArchive={onSelectArchive}
            onSelectAppearance={onSelectAppearance}
            onSelectAbout={onSelectAbout}
          />

          <div className="settings-panel">
            {settingsSection === "providers" && (
              <ProviderSettingsSection {...providerSectionProps} />
            )}

            {settingsSection === "archive" && (
              <ArchiveSettingsSection
                archivedSessions={archivedSessions}
                providerLabel={providerLabel}
                onRestoreArchivedSession={onRestoreArchivedSession}
              />
            )}

            {settingsSection === "appearance" && (
              <AppearanceSettingsSection />
            )}

            {settingsSection === "about" && (
              <AboutSettingsSection appVersion={appVersion} appLogo={appLogo} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
