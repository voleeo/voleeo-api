import type {
  GitChange,
  GitCommit,
  GitEntityChange,
  GitEntityConflict,
  GitFileChange,
  GitRepoInfo,
} from "../../../../packages/types/bindings"

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
  conflictDiff: (path: string) => Promise<string>
  commitChanges: (commitId: string) => Promise<GitEntityChange[]>
  rollback: (path: string | string[]) => Promise<void>
  revertCommit: (commitId: string, path?: string | null) => Promise<void>
  setShowHistory: (v: boolean) => void
  reset: () => void
}
