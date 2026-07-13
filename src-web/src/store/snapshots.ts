import { create } from "zustand"
import { errorMessage } from "@/lib/error"
import { useRequestStore } from "@/store/requests"
import { useToastStore } from "@/store/toast"
import { useTreeUiStore } from "@/store/treeUi"
import type {
  Snapshot,
  SnapshotReplayResult,
  SnapshotSummary,
} from "../../../packages/types/bindings"
import { commands } from "../../../packages/types/bindings"

interface SnapshotsStore {
  byRequest: Record<string, SnapshotSummary[]>
  loadedWorkspaceId: string | null
  activeSnapshot: Snapshot | null
  replay: SnapshotReplayResult | null
  replaying: boolean

  load: (workspaceId: string) => Promise<void>
  reload: () => Promise<void>
  saveSnapshot: (
    workspaceId: string,
    requestId: string,
    responseId: string,
    name?: string,
  ) => Promise<void>
  openSnapshot: (workspaceId: string, snapshotId: string) => Promise<void>
  revealSnapshot: (
    workspaceId: string,
    snapshotId: string,
    opts?: { rename?: boolean },
  ) => Promise<void>
  closeSnapshot: () => void
  renameSnapshot: (
    workspaceId: string,
    snapshotId: string,
    name: string,
  ) => Promise<void>
  setPinned: (
    workspaceId: string,
    snapshotId: string,
    pinned: boolean,
  ) => Promise<void>
  deleteSnapshot: (workspaceId: string, snapshotId: string) => Promise<void>
  replaySnapshot: (workspaceId: string, snapshotId: string) => Promise<void>
}

function groupByRequest(
  summaries: SnapshotSummary[],
): Record<string, SnapshotSummary[]> {
  const grouped: Record<string, SnapshotSummary[]> = {}
  for (const s of summaries) {
    const bucket = grouped[s.requestId] ?? []
    bucket.push(s)
    grouped[s.requestId] = bucket
  }
  return grouped
}

export const useSnapshotsStore = create<SnapshotsStore>((set, get) => ({
  byRequest: {},
  loadedWorkspaceId: null,
  activeSnapshot: null,
  replay: null,
  replaying: false,

  load: async (workspaceId) => {
    if (get().loadedWorkspaceId === workspaceId) return
    const result = await commands.snapshotListSummaries(workspaceId)
    set({
      byRequest: result.status === "ok" ? groupByRequest(result.data) : {},
      loadedWorkspaceId: workspaceId,
      activeSnapshot: null,
      replay: null,
    })
  },

  reload: async () => {
    const workspaceId = get().loadedWorkspaceId
    if (!workspaceId) return
    const result = await commands.snapshotListSummaries(workspaceId)
    if (result.status === "ok") set({ byRequest: groupByRequest(result.data) })
  },

  saveSnapshot: async (workspaceId, requestId, responseId, name) => {
    const result = await commands.snapshotSave(
      workspaceId,
      requestId,
      responseId,
      name ?? null,
    )
    if (result.status === "error") {
      useToastStore.getState().show(errorMessage(result.error), 3500, "error")
      return
    }
    await get().reload()
    await get().revealSnapshot(workspaceId, result.data.id, { rename: true })
  },

  revealSnapshot: async (workspaceId, snapshotId, opts) => {
    await get().load(workspaceId)
    const requestId = Object.entries(get().byRequest).find(([, list]) =>
      list.some((s) => s.id === snapshotId),
    )?.[0]
    if (!requestId) return

    const { requests, folders } = useRequestStore.getState()
    const req = requests.find((r) => r.id === requestId)
    const expand: string[] = [requestId]
    let fid = req?.folderId ?? null
    while (fid) {
      expand.push(fid)
      fid = folders.find((f) => f.id === fid)?.folderId ?? null
    }
    const tree = useTreeUiStore.getState()
    tree.ensureFoldersOpen(expand)
    useRequestStore.getState().setActiveSnapshot(snapshotId)
    await get().openSnapshot(workspaceId, snapshotId)
    tree.setSelection([snapshotId], snapshotId)
    tree.setFocusedNodeId(snapshotId)
    if (opts?.rename) tree.requestRename(snapshotId)
  },

  openSnapshot: async (workspaceId, snapshotId) => {
    const result = await commands.snapshotGet(workspaceId, snapshotId)
    if (result.status === "error") {
      useToastStore.getState().show(errorMessage(result.error), 3500, "error")
      return
    }
    set({ activeSnapshot: result.data, replay: null })
    const latest = await commands.snapshotGetLatestReplay(
      workspaceId,
      snapshotId,
    )
    if (latest.status === "ok" && latest.data) {
      const latestResponse = latest.data.response
      set((s) =>
        s.activeSnapshot?.id === snapshotId
          ? {
              replay: {
                response: latestResponse,
                statusMatches:
                  latestResponse.status === result.data.response.status,
              },
            }
          : s,
      )
    }
  },

  closeSnapshot: () => set({ activeSnapshot: null, replay: null }),

  renameSnapshot: async (workspaceId, snapshotId, name) => {
    const result = await commands.snapshotRename(workspaceId, snapshotId, name)
    if (result.status === "error") {
      useToastStore.getState().show(errorMessage(result.error), 3500, "error")
      return
    }
    set((s) => ({
      activeSnapshot:
        s.activeSnapshot?.id === snapshotId
          ? { ...s.activeSnapshot, name: result.data.name }
          : s.activeSnapshot,
    }))
    await get().reload()
  },

  setPinned: async (workspaceId, snapshotId, pinned) => {
    const result = await commands.snapshotSetPinned(
      workspaceId,
      snapshotId,
      pinned,
    )
    if (result.status === "error") {
      useToastStore.getState().show(errorMessage(result.error), 3500, "error")
      return
    }
    await get().reload()
  },

  deleteSnapshot: async (workspaceId, snapshotId) => {
    const wasActive = useRequestStore.getState().activeSnapshotId === snapshotId
    const parentRequestId = Object.entries(get().byRequest).find(([, list]) =>
      list.some((s) => s.id === snapshotId),
    )?.[0]

    const result = await commands.snapshotDelete(workspaceId, snapshotId)
    if (result.status === "error") {
      useToastStore.getState().show(errorMessage(result.error), 3500, "error")
      return
    }
    set((s) =>
      s.activeSnapshot?.id === snapshotId
        ? { activeSnapshot: null, replay: null }
        : s,
    )
    await get().reload()

    if (wasActive && parentRequestId) {
      useRequestStore.getState().setActiveRequest(parentRequestId)
      const tree = useTreeUiStore.getState()
      tree.setSelection([parentRequestId], parentRequestId)
      tree.setFocusedNodeId(parentRequestId)
    }
  },

  replaySnapshot: async (workspaceId, snapshotId) => {
    set({ replaying: true })
    const result = await commands.snapshotReplay(workspaceId, snapshotId)
    set({ replaying: false })
    if (result.status === "error") {
      useToastStore.getState().show(errorMessage(result.error), 3500, "error")
      return
    }
    set((s) =>
      s.activeSnapshot?.id === snapshotId ? { replay: result.data } : s,
    )
  },
}))
