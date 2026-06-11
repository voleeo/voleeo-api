import { create } from "zustand"

interface PaneTabsStore {
  requestTabs: Record<string, string>
  folderTabs: Record<string, string>
  wsTabs: Record<string, string>
  grpcTabs: Record<string, string>
  grpcModes: Record<string, string>
  setRequestTab: (id: string, tab: string) => void
  setFolderTab: (id: string, tab: string) => void
  setWsTab: (id: string, tab: string) => void
  setGrpcTab: (id: string, tab: string) => void
  setGrpcMode: (id: string, mode: string) => void
}

export const usePaneTabsStore = create<PaneTabsStore>((set) => ({
  requestTabs: {},
  folderTabs: {},
  wsTabs: {},
  grpcTabs: {},
  grpcModes: {},
  setRequestTab: (id, tab) =>
    set((s) => ({ requestTabs: { ...s.requestTabs, [id]: tab } })),
  setFolderTab: (id, tab) =>
    set((s) => ({ folderTabs: { ...s.folderTabs, [id]: tab } })),
  setWsTab: (id, tab) => set((s) => ({ wsTabs: { ...s.wsTabs, [id]: tab } })),
  setGrpcTab: (id, tab) =>
    set((s) => ({ grpcTabs: { ...s.grpcTabs, [id]: tab } })),
  setGrpcMode: (id, mode) =>
    set((s) => ({ grpcModes: { ...s.grpcModes, [id]: mode } })),
}))
