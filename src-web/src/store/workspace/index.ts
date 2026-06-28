import { invoke } from "@tauri-apps/api/core"
import { emit } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { create } from "zustand"
import { EVENTS } from "@/config/events"
import { WorkspaceListSchema } from "@/lib/schemas"
import {
  getCachedSettings,
  loadAllSettings,
  patchSettings,
} from "@/lib/workspaceSettings"
import type {
  AuthConfig,
  DnsOverride,
  RequestParameter,
} from "../../../../packages/types/bindings"
import { commands } from "../../../../packages/types/bindings"
import {
  applyWelcomeWindowSize,
  applyWindowSize,
  attachResizeListener,
  DEFAULT_WORKSPACE_HEIGHT,
  DEFAULT_WORKSPACE_WIDTH,
} from "./windowSize"

export { initWorkspaceListeners } from "./listeners"
export { applyWelcomeWindowSize } from "./windowSize"
export type { AuthConfig, DnsOverride, RequestParameter }

export type Tool = "welcome" | "api" | "git"
export type PanelLayout = "columns" | "rows"
export type WorkspaceSettingsSection =
  | "workspace"
  | "storage"
  | "headers"
  | "auth"
  | "dns"

export interface Workspace {
  id: string
  name: string
  model: string
  encrypted?: boolean
  syncDir?: string | null
  headers?: RequestParameter[]
  auth?: AuthConfig
  dnsOverrides?: DnsOverride[]
  createdAt: string
  updatedAt: string
}

function getLayout(wsId: string): PanelLayout {
  const l = getCachedSettings(wsId).panelLayout
  return l === "rows" ? "rows" : "columns"
}

function getTreeVisible(wsId: string): boolean {
  return getCachedSettings(wsId).treeVisible ?? true
}

interface UiStore {
  activeTool: Tool
  activeWorkspaceId: string | null
  workspaces: Workspace[]
  workspaceWindowMap: Record<string, string>
  panelLayout: PanelLayout
  treeVisible: boolean
  graphqlDocsOpen: boolean
  pendingSettingsSection: WorkspaceSettingsSection | null
  pendingSettingsFocusKey: string | null
  setActiveTool: (tool: Tool) => void
  openWorkspace: (id: string, tool?: Tool) => void
  loadWorkspaces: () => Promise<void>
  togglePanelLayout: () => void
  toggleTreeVisible: () => void
  setGraphqlDocsOpen: (open: boolean) => void
  requestWorkspaceSettings: (
    section: WorkspaceSettingsSection,
    focusKey?: string,
  ) => void
  clearPendingSettings: () => void
  pendingCookies: { jarId: string | null } | null
  pendingEnv: { envId: string | null } | null
  requestCookies: (jarId: string | null) => void
  clearPendingCookies: () => void
  requestEnvironments: (envId: string | null) => void
  clearPendingEnv: () => void
  updateWorkspaceHeaders: (
    workspaceId: string,
    headers: RequestParameter[],
  ) => Promise<void>
  updateWorkspaceAuth: (workspaceId: string, auth: AuthConfig) => Promise<void>
  updateWorkspaceDnsOverrides: (
    workspaceId: string,
    overrides: DnsOverride[],
  ) => Promise<void>
}

export const useUiStore = create<UiStore>((set, get) => ({
  activeTool: "welcome",
  activeWorkspaceId: null,
  workspaces: [],
  workspaceWindowMap: {},
  panelLayout: "columns",
  treeVisible: true,
  graphqlDocsOpen: false,
  pendingSettingsSection: null,
  pendingSettingsFocusKey: null,
  setActiveTool: (tool) => {
    set({ activeTool: tool })
    if (tool === "welcome") {
      applyWelcomeWindowSize()
    }
  },
  requestWorkspaceSettings: (section, focusKey) =>
    set({
      pendingSettingsSection: section,
      pendingSettingsFocusKey: focusKey ?? null,
    }),
  clearPendingSettings: () =>
    set({ pendingSettingsSection: null, pendingSettingsFocusKey: null }),
  pendingCookies: null,
  pendingEnv: null,
  requestCookies: (jarId) => set({ pendingCookies: { jarId } }),
  clearPendingCookies: () => set({ pendingCookies: null }),
  requestEnvironments: (envId) => set({ pendingEnv: { envId } }),
  clearPendingEnv: () => set({ pendingEnv: null }),
  setGraphqlDocsOpen: (open) => set({ graphqlDocsOpen: open }),
  togglePanelLayout: () =>
    set((s) => {
      const next: PanelLayout = s.panelLayout === "columns" ? "rows" : "columns"
      if (s.activeWorkspaceId)
        patchSettings(s.activeWorkspaceId, { panelLayout: next })
      return { panelLayout: next }
    }),
  toggleTreeVisible: () =>
    set((s) => {
      const next = !s.treeVisible
      if (s.activeWorkspaceId)
        patchSettings(s.activeWorkspaceId, { treeVisible: next })
      return { treeVisible: next }
    }),
  openWorkspace: (id, tool?) => {
    patchSettings(id, { openedAt: new Date().toISOString() })
    set({
      activeWorkspaceId: id,
      activeTool: tool ?? "api",
      panelLayout: getLayout(id),
      treeVisible: getTreeVisible(id),
    })
    import("../environment")
      .then(({ useEnvironmentStore }) => {
        useEnvironmentStore.getState().load(id)
      })
      .catch(() => {})
    import("../git")
      .then(({ useGitStore }) => {
        useGitStore.getState().load(id)
      })
      .catch(() => {})
    import("../cookies")
      .then(({ useCookiesStore }) => {
        useCookiesStore.getState().load(id)
      })
      .catch(() => {})
    const saved = getCachedSettings(id).windowSize
    applyWindowSize(
      saved?.width ?? DEFAULT_WORKSPACE_WIDTH,
      saved?.height ?? DEFAULT_WORKSPACE_HEIGHT,
      true,
    )
    try {
      const label = getCurrentWebviewWindow().label
      emit(EVENTS.workspaceRegistered, {
        workspaceId: id,
        windowLabel: label,
      }).catch(() => {})
    } catch {}
  },
  loadWorkspaces: async () => {
    const [raw] = await Promise.all([
      invoke("list_workspaces").catch(() => null),
      loadAllSettings(),
    ])
    const workspaces = raw
      ? (WorkspaceListSchema.catch(get().workspaces).parse(raw) as Workspace[])
      : get().workspaces
    set({ workspaces })
  },
  updateWorkspaceHeaders: async (workspaceId, headers) => {
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === workspaceId
          ? { ...w, headers, updatedAt: new Date().toISOString() }
          : w,
      ),
    }))
    await commands.updateWorkspaceHeaders(workspaceId, headers)
  },
  updateWorkspaceAuth: async (workspaceId, auth) => {
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === workspaceId
          ? { ...w, auth, updatedAt: new Date().toISOString() }
          : w,
      ),
    }))
    await commands.updateWorkspaceAuth(workspaceId, auth)
  },
  updateWorkspaceDnsOverrides: async (workspaceId, overrides) => {
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === workspaceId
          ? {
              ...w,
              dnsOverrides: overrides,
              updatedAt: new Date().toISOString(),
            }
          : w,
      ),
    }))
    await commands.updateWorkspaceDnsOverrides(workspaceId, overrides)
  },
}))

attachResizeListener(() => useUiStore.getState().activeWorkspaceId)
