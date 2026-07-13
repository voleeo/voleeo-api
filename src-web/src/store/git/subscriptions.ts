import { listen } from "@tauri-apps/api/event"
import type { StoreApi, UseBoundStore } from "zustand"
import { EVENTS } from "@/config/events"
import { useRequestStore } from "../requests"
import { useSnapshotsStore } from "../snapshots"
import { useUiStore } from "../workspace"
import type { GitStore } from "./types"

export function registerGitSubscriptions(
  useGitStore: UseBoundStore<StoreApi<GitStore>>,
) {
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

  // Snapshots live in their own store (git-synced files under the workspace),
  // so saving/deleting one must also refresh the changes badge + review.
  useSnapshotsStore.subscribe((state, prev) => {
    if (state.byRequest === prev.byRequest) return
    const id = useGitStore.getState().loadedWorkspaceId
    if (id) useGitStore.getState().refreshDebounced(id)
  })

  // Workspace rename / header / auth edits rewrite workspace.yaml.
  useUiStore.subscribe((state, prev) => {
    if (state.workspaces === prev.workspaces) return
    const id = useGitStore.getState().loadedWorkspaceId
    if (id) useGitStore.getState().refreshDebounced(id)
  })

  listen<{ workspaceId: string }>(EVENTS.gitStatusChanged, (e) => {
    const store = useGitStore.getState()
    const id = store.loadedWorkspaceId
    if (!id || id !== e.payload.workspaceId) return

    store.refreshDebounced(id)
  }).catch(() => {})

  listen<{
    workspaceId: string
    view: "changes" | "history"
    path?: string | null
    name?: string | null
  }>(EVENTS.gitView, (e) => {
    const id = useGitStore.getState().loadedWorkspaceId
    if (!id || id !== e.payload.workspaceId) return
    useGitStore.setState({
      showHistory: e.payload.view === "history",
      historyPath: e.payload.path ?? null,
      historyName: e.payload.name ?? null,
    })
  }).catch(() => {})
}
