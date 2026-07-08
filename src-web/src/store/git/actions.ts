import { emit } from "@tauri-apps/api/event"
import type { StoreApi } from "zustand"
import { EVENTS } from "@/config/events"
import { commands } from "../../../../packages/types/bindings"
import { buildChangeMap } from "../gitChangeMap"
import { unwrap, withOp } from "../gitStoreUtil"
import { useRequestStore } from "../requests"
import type { GitStore } from "./types"

type SetState = StoreApi<GitStore>["setState"]
type GetState = StoreApi<GitStore>["getState"]

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let refreshSeq = 0
let repoSeq = 0

function mapFor(files: GitStore["files"]) {
  const { requests, folders, connections, grpcRequests } =
    useRequestStore.getState()
  return buildChangeMap(files, requests, folders, connections, grpcRequests)
}

export function createGitActions(set: SetState, get: GetState) {
  return {
    load: async (workspaceId: string) => {
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

    refresh: async (workspaceId?: string) => {
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

    reloadRepo: async (workspaceId?: string) => {
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

    refreshDebounced: (workspaceId: string) => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        get().refresh(workspaceId)
        get().loadChanges(workspaceId)

        const rseq = ++repoSeq
        commands.gitRepoInfo(workspaceId).then((r) => {
          if (r.status === "ok" && rseq === repoSeq) {
            set({ repo: r.data })
            if (r.data.merging) get().loadConflicts(workspaceId)
            else set({ entityConflicts: [] })
          }
        })
      }, 400)
    },

    loadChanges: async (workspaceId?: string) => {
      const id = workspaceId ?? get().loadedWorkspaceId
      if (!id) return
      try {
        set({ changes: await unwrap(commands.gitChanges(id)) })
      } catch {
        // Keep prior changes on a transient read failure.
      }
    },

    loadConflicts: async (workspaceId?: string) => {
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

    setRemote: (name: string, url: string) =>
      withOp(set, get, "update", async (id) => {
        await unwrap(commands.gitSetRemote(id, name, url))
        set({ repo: await unwrap(commands.gitRepoInfo(id)) })
      }),

    loadLog: async (limit = 50) => {
      const id = get().loadedWorkspaceId
      if (!id) return
      set({ log: await unwrap(commands.gitLog(id, limit)) })
    },

    logForPath: async (path: string, limit = 30) => {
      const id = get().loadedWorkspaceId
      if (!id) return []
      return unwrap(commands.gitLogForPath(id, path, limit))
    },

    entityDiff: async (path: string) => {
      const id = get().loadedWorkspaceId
      if (!id) return ""
      return unwrap(commands.gitEntityDiff(id, path))
    },

    conflictDiff: async (path: string) => {
      const id = get().loadedWorkspaceId
      if (!id) return ""
      return unwrap(commands.gitConflictDiff(id, path))
    },

    commitChanges: async (commitId: string) => {
      const id = get().loadedWorkspaceId
      if (!id) return []
      return unwrap(commands.gitCommitChanges(id, commitId))
    },

    rollback: async (path: string | string[]) => {
      const id = get().loadedWorkspaceId
      if (!id) return
      const paths = Array.isArray(path) ? path : [path]
      if (paths.length === 0) return
      await unwrap(commands.gitDiscard(id, paths))
      await useRequestStore.getState().reload()
      void emit(EVENTS.gitEntitiesReload, {}).catch(() => {})
      await get().refresh(id)
      await get().loadChanges(id)
    },

    revertCommit: async (commitId: string, path?: string | null) => {
      const id = get().loadedWorkspaceId
      if (!id) return
      await unwrap(commands.gitRevertCommit(id, commitId, path ?? null))
      await useRequestStore.getState().reload()
      void emit(EVENTS.gitEntitiesReload, {}).catch(() => {})
      await get().refresh(id)
      await get().loadChanges(id)
      set({ showHistory: false, historyPath: null, historyName: null })
    },

    setShowHistory: (showHistory: boolean) => set({ showHistory }),

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
  }
}
