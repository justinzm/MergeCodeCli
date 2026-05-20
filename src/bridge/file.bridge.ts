export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  gitStatus?: "" | "M" | "A" | "D" | "U";
  hasGitChanges?: boolean;
  children?: FileTreeNode[];
}

export const fileBridge = {
  readTree(payload: { cwd: string; depth?: number }): Promise<{ cwd: string; isGitRepo: boolean; items: FileTreeNode[] }> {
    return window.electronAPI.files.readTree(payload);
  },
  openPath(payload: { path: string }): Promise<{ ok: boolean }> {
    const filesApi = (window.electronAPI as unknown as {
      files?: {
        openPath?: (input: { path: string }) => Promise<{ ok: boolean }>;
        open?: (input: { path: string }) => Promise<{ ok: boolean }>;
      };
    })?.files;

    if (typeof filesApi?.openPath === "function") {
      return filesApi.openPath(payload);
    }

    // Backward compatibility: some preload builds exposed `files.open` instead of `files.openPath`.
    if (typeof filesApi?.open === "function") {
      return filesApi.open(payload);
    }

    throw new Error("当前客户端未暴露 files.openPath，请重启应用并更新到最新版本");
  },
  saveAttachmentImage(payload: { cwd: string; sessionId: string }): Promise<{
    ok: boolean;
    reason?: string;
    absPath?: string;
    relPath?: string;
    mimeType?: string;
  }> {
    const filesApi = (window.electronAPI as unknown as {
      files?: {
        saveAttachmentImage?: (input: { cwd: string; sessionId: string }) => Promise<{
          ok: boolean;
          reason?: string;
          absPath?: string;
          relPath?: string;
          mimeType?: string;
        }>;
      };
    })?.files;
    if (typeof filesApi?.saveAttachmentImage === "function") {
      return filesApi.saveAttachmentImage(payload);
    }
    throw new Error("当前客户端未暴露 files.saveAttachmentImage，请重启应用并更新到最新版本");
  }
};
