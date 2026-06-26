import { emit, listen } from "@tauri-apps/api/event"
import { create } from "zustand"
import type {
  GitChange,
  GitCommit,
  GitEntityChange,
  GitEntityConflict,
  GitFileChange,
  GitRepoInfo,
} from "../../../packages/types/bindings"
import { commands } from "../../../packages/types/bindings"
import { buildChangeMap } from "./gitChangeMap"
import { unwrap, withOp } from "./gitStoreUtil"
import { useRequestStore } from "./requests"
import { useUiStore } from "./workspace"

export type {
  GitChange,
  GitCommit,
  GitEntityChange,
  GitEntityConflict,
  GitFileChange,
  GitRepoInfo,
}

export type GitOp = "init" | "publish" | "update" | "share" | "merge"

export interface GitStore {
  loadedWorkspaceId: string | null
  repo: GitRepoInfo | null
  files: GitFileChange[]
  changeByNode: Record<string, GitChange>
  ownChangeByNode: Record<string, GitChange>
  folderDescendantChanged: Set<string>
  changes: GitEntityChange[]
  entityConflicts: GitEntityConflict[]
  log: GitCommit[]
  showHistory: boolean
  historyPath: string | null
  historyName: string | null
  op: GitOp | null
  error: string | null
  authPrompt: string | null

  load: (workspaceId: string) => Promise<void>
  refresh: (workspaceId?: string) => Promise<void>
  reloadRepo: (workspaceId?: string) => Promise<void>
  refreshDebounced: (workspaceId: string) => void
  loadChanges: (workspaceId?: string) => Promise<void>
  loadConflicts: (workspaceId?: string) => Promise<void>
  init: () => Promise<void>
  setRemote: (name: string, url: string) => Promise<void>
  loadLog: (limit?: number) => Promise<void>
  logForPath: (path: string, limit?: number) => Promise<GitCommit[]>
  entityDiff: (path: string) => Promise<string>
  commitChanges: (commitId: string) => Promise<GitEntityChange[]>
  rollback: (path: string | string[]) => Promise<void>
  /** Undo a commit into the working tree as pending changes (whole commit, or
   *  one entity when `path` is given), then surface the Changes view. */
  revertCommit: (commitId: string, path?: string | null) => Promise<void>
  setShowHistory: (v: boolean) => void
  reset: () => void
}

function mapFor(files: GitFileChange[]) {
  const { requests, folders, connections, grpcRequests } =
    useRequestStore.getState()
  return buildChangeMap(files, requests, folders, connections, grpcRequests)
}

export const useGitStore = create<GitStore>((set, get) => ({
  loadedWorkspaceId: null,
  repo: null,
  files: [],
  changeByNode: {},
  ownChangeByNode: {},
  folderDescendantChanged: new Set(),
  changes: [],
  entityConflicts: [],
  log: [],
  showHistory: false,
  historyPath: null,
  historyName: null,
  op: null,
  error: null,
  authPrompt: null,

  load: async (workspaceId) => {
    set({ loadedWorkspaceId: workspaceId, error: null })
    try {
      const repo = await unwrap(commands.gitRepoInfo(workspaceId))
      set({ repo })
      if (!repo.isRepo) {
        set({
          files: [],
          changeByNode: {},
          ownChangeByNode: {},
          folderDescendantChanged: new Set(),
          changes: [],
          entityConflicts: [],
        })
        return
      }
      await get().refresh(workspaceId)
      await get().loadChanges(workspaceId)
      if (repo.merging) await get().loadConflicts(workspaceId)
      else set({ entityConflicts: [] })
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  refresh: async (workspaceId) => {
    const id = workspaceId ?? get().loadedWorkspaceId
    if (!id) return

    const seq = ++refreshSeq
    try {
      const status = await unwrap(commands.gitStatus(id))
      if (seq !== refreshSeq) return
      const maps = mapFor(status.files)
      set({
        files: status.files,
        changeByNode: maps.byNode,
        ownChangeByNode: maps.ownByNode,
        folderDescendantChanged: maps.folderDescendantChanged,
      })
    } catch {
      // Not a repo / transient — keep prior state.
    }
  },

  reloadRepo: async (workspaceId) => {
    const id = workspaceId ?? get().loadedWorkspaceId
    if (!id) return
    const rseq = ++repoSeq
    const r = await commands.gitRepoInfo(id)
    if (r.status === "ok" && rseq === repoSeq) {
      set({ repo: r.data })
      if (r.data.merging) get().loadConflicts(id)
      else set({ entityConflicts: [] })
    }
  },

  refreshDebounced: (workspaceId) => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      get().refresh(workspaceId)
      get().loadChanges(workspaceId)

      const rseq = ++repoSeq
      commands.gitRepoInfo(workspaceId).then((r) => {
        if (r.status === "ok" && rseq === repoSeq) {
          useGitStore.setState({ repo: r.data })
          if (r.data.merging) get().loadConflicts(workspaceId)
          else useGitStore.setState({ entityConflicts: [] })
        }
      })
    }, 400)
  },

  loadChanges: async (workspaceId) => {
    const id = workspaceId ?? get().loadedWorkspaceId
    if (!id) return
    try {
      set({ changes: await unwrap(commands.gitChanges(id)) })
    } catch {
      // Keep prior changes on a transient read failure.
    }
  },

  loadConflicts: async (workspaceId) => {
    const id = workspaceId ?? get().loadedWorkspaceId
    if (!id) return
    set({ entityConflicts: await unwrap(commands.gitEntityConflicts(id)) })
  },

  init: () =>
    withOp(set, get, "init", async (id) => {
      const repo = await unwrap(commands.gitInit(id))
      set({ repo })
      await get().refresh(id)
      await get().loadChanges(id)
    }),

  setRemote: (name, url) =>
    withOp(set, get, "update", async (id) => {
      await unwrap(commands.gitSetRemote(id, name, url))
      set({ repo: await unwrap(commands.gitRepoInfo(id)) })
    }),

  loadLog: async (limit = 50) => {
    const id = get().loadedWorkspaceId
    if (!id) return
    set({ log: await unwrap(commands.gitLog(id, limit)) })
  },

  logForPath: async (path, limit = 30) => {
    const id = get().loadedWorkspaceId
    if (!id) return []
    return unwrap(commands.gitLogForPath(id, path, limit))
  },

  entityDiff: async (path) => {
    const id = get().loadedWorkspaceId
    if (!id) return ""
    return unwrap(commands.gitEntityDiff(id, path))
  },

  commitChanges: async (commitId) => {
    const id = get().loadedWorkspaceId
    if (!id) return []
    return unwrap(commands.gitCommitChanges(id, commitId))
  },

  rollback: async (path) => {
    const id = get().loadedWorkspaceId
    if (!id) return
    const paths = Array.isArray(path) ? path : [path]
    if (paths.length === 0) return
    await unwrap(commands.gitDiscard(id, paths))
    await useRequestStore.getState().reload()
    void emit("git:entities-reload", {}).catch(() => {})
    await get().refresh(id)
    await get().loadChanges(id)
  },

  revertCommit: async (commitId, path) => {
    const id = get().loadedWorkspaceId
    if (!id) return
    await unwrap(commands.gitRevertCommit(id, commitId, path ?? null))
    await useRequestStore.getState().reload()
    void emit("git:entities-reload", {}).catch(() => {})
    await get().refresh(id)
    await get().loadChanges(id)
    set({ showHistory: false, historyPath: null, historyName: null })
  },

  setShowHistory: (showHistory) => set({ showHistory }),

  reset: () =>
    set({
      loadedWorkspaceId: null,
      repo: null,
      files: [],
      changeByNode: {},
      ownChangeByNode: {},
      folderDescendantChanged: new Set(),
      changes: [],
      entityConflicts: [],
      log: [],
      showHistory: false,
      historyPath: null,
      historyName: null,
      op: null,
      error: null,
      authPrompt: null,
    }),
}))

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let refreshSeq = 0
let repoSeq = 0

// Refresh badges + review after any entity mutation (saves are debounced upstream).
useRequestStore.subscribe((state, prev) => {
  if (
    state.requests === prev.requests &&
    state.folders === prev.folders &&
    state.connections === prev.connections &&
    state.grpcRequests === prev.grpcRequests
  )
    return
  const id = useGitStore.getState().loadedWorkspaceId
  if (id) useGitStore.getState().refreshDebounced(id)
})

// Workspace rename / header / auth edits rewrite workspace.yaml.
useUiStore.subscribe((state, prev) => {
  if (state.workspaces === prev.workspaces) return
  const id = useGitStore.getState().loadedWorkspaceId
  if (id) useGitStore.getState().refreshDebounced(id)
})

listen<{ workspaceId: string }>("git:status-changed", (e) => {
  const store = useGitStore.getState()
  const id = store.loadedWorkspaceId
  if (!id || id !== e.payload.workspaceId) return

  store.refreshDebounced(id)
}).catch(() => {})

// The menu (main window) drives the git window between Changes and History.
// `path`/`name` (set when opened from a tree row) scope History to one entity.
listen<{
  workspaceId: string
  view: "changes" | "history"
  path?: string | null
  name?: string | null
}>("git:view", (e) => {
  const id = useGitStore.getState().loadedWorkspaceId
  if (!id || id !== e.payload.workspaceId) return
  useGitStore.setState({
    showHistory: e.payload.view === "history",
    historyPath: e.payload.path ?? null,
    historyName: e.payload.name ?? null,
  })
}).catch(() => {})
