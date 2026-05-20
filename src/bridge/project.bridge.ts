export interface ProjectItem {
  id: string;
  name: string;
  path: string;
}

export const projectBridge = {
  list(): Promise<ProjectItem[]> {
    return window.electronAPI.projects.list();
  },
  add(): Promise<ProjectItem | null> {
    return window.electronAPI.projects.add();
  },
  remove(id: string): Promise<void> {
    return window.electronAPI.projects.remove(id);
  }
};
