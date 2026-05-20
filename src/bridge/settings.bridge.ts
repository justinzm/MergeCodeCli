export interface StartupEnvPair {
  key: string;
  value: string;
}

export interface ProviderProfile {
  id: string;
  name: string;
  envVars: StartupEnvPair[];
}

export interface ProviderSettingsEntry {
  defaultProfileId: string;
  enabledProfileId?: string;
  profiles: ProviderProfile[];
}

export interface ProviderSettings {
  providers: {
    claude: ProviderSettingsEntry;
    codex: ProviderSettingsEntry;
    gemini: ProviderSettingsEntry;
  };
}

export const settingsBridge = {
  getClaude(): Promise<ProviderSettings> {
    return window.electronAPI.settings.getClaude();
  },
  saveClaude(payload: ProviderSettings): Promise<ProviderSettings> {
    return window.electronAPI.settings.saveClaude(payload);
  },
  testProvider(payload: {
    provider: "claude" | "codex" | "gemini";
    profileId: string;
    envVars: StartupEnvPair[];
  }): Promise<{ ok: boolean; message: string }> {
    return window.electronAPI.settings.testProvider(payload);
  },
  startProviderOAuthLogin(payload: {
    provider: "claude" | "codex" | "gemini";
    profileId: string;
    projectId?: string;
    cwd?: string;
  }): Promise<{ ok: boolean; message: string; session?: { sessionId: string; projectId: string } }> {
    return window.electronAPI.settings.startProviderOAuthLogin(payload);
  },
  probeProviderOAuth(payload: {
    provider: "claude" | "codex" | "gemini";
    profileId: string;
    envVars: StartupEnvPair[];
  }): Promise<{ ok: boolean; message: string }> {
    return window.electronAPI.settings.probeProviderOAuth(payload);
  },
  getProviderOAuthLinks(payload: {
    provider: "claude" | "codex" | "gemini";
    profileId?: string;
    sessionId?: string;
  }): Promise<{
    ok: boolean;
    sessionId?: string;
    allUrls: string[];
    authUrls: string[];
    autoOpenedUrl?: string;
  }> {
    return window.electronAPI.settings.getProviderOAuthLinks(payload);
  },
  testProviderProxy(payload: {
    provider: "claude" | "codex" | "gemini";
    profileId: string;
    envVars: StartupEnvPair[];
    proxyUrl: string;
  }): Promise<{ ok: boolean; message: string }> {
    return window.electronAPI.settings.testProviderProxy(payload);
  }
};
