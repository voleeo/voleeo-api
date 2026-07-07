import { create } from "zustand"
import { createGitActions } from "./actions"
import { registerGitSubscriptions } from "./subscriptions"
import type { GitStore } from "./types"

export type {
  GitChange,
  GitCommit,
  GitEntityChange,
  GitEntityConflict,
  GitFileChange,
  GitOp,
  GitRepoInfo,
  GitStore,
} from "./types"

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
  ...createGitActions(set, get),
}))

registerGitSubscriptions(useGitStore)
