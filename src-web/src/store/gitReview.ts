import { emit, listen } from "@tauri-apps/api/event"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { EVENTS } from "@/config/events"
import type {
  Choice,
  ConflictEntity,
  EntityChange,
  EntityType,
} from "@/lib/gitEntityDiff"
import {
  buildConflictEntities,
  mergeChoice,
  revertFieldEntity,
} from "@/lib/gitEntityDiff"
import type { GitEntity_Deserialize } from "../../../packages/types/bindings"
import { commands } from "../../../packages/types/bindings"
import { useCookiesStore } from "./cookies"
import { useEnvironmentStore } from "./environment"
import { useGitStore } from "./git"
import { unwrap, withOp } from "./gitStoreUtil"
import { useRequestStore } from "./requests"
import { useToastStore } from "./toast"
import { useUiStore } from "./workspace"

const set = useGitStore.setState
const get = useGitStore.getState

/** Payload telling the main window which entity to open. */
export interface GitRevealPayload {
  workspaceId: string
  type: EntityType
  nodeId: string | null
}

/** Open the clicked entity back in the main window (and bring it to front). */
export async function revealEntity(
  type: EntityType,
  nodeId: string | null,
): Promise<void> {
  const workspaceId = get().loadedWorkspaceId
  if (!workspaceId) return
  await emit(EVENTS.gitReveal, {
    workspaceId,
    type,
    nodeId,
  } satisfies GitRevealPayload)
  const main = await WebviewWindow.getByLabel("main").catch(() => null)
  await main?.show().catch(() => {})
  await main?.setFocus().catch(() => {})
  // Close the Git Sync window — the user is heading back to the workspace.
  await getCurrentWindow()
    .close()
    .catch(() => {})
}

export async function closeIfNothingLeft(): Promise<void> {
  const g = get()
  if (g.changes.length > 0 || g.entityConflicts.length > 0) return
  await getCurrentWindow()
    .close()
    .catch(() => {})
}

async function reloadEntities(): Promise<void> {
  await useRequestStore.getState().reload()
  await useEnvironmentStore.getState().reload()
  await useCookiesStore.getState().reload()
  await useUiStore.getState().loadWorkspaces()
}

export async function reloadEverywhere(): Promise<void> {
  await reloadEntities()
  void emit(EVENTS.gitEntitiesReload, {}).catch(() => {})
}

// Re-read entities whenever any window rewrites the worktree.
listen(EVENTS.gitEntitiesReload, () => {
  void reloadEntities()
}).catch(() => {})

export function publish(
  message: string,
  paths: string[],
  author?: { name: string; email: string },
): Promise<void> {
  return withOp(set, get, "publish", async (id) => {
    await unwrap(commands.gitUnstageAll(id))
    await unwrap(commands.gitStage(id, paths))
    await unwrap(
      commands.gitCommit(
        id,
        message,
        author?.name ?? null,
        author?.email ?? null,
      ),
    )
    set({ repo: await unwrap(commands.gitRepoInfo(id)) })
    await get().loadChanges(id)
    await get().refresh(id)
  })
}

export function getUpdates(): Promise<void> {
  return withOp(set, get, "update", async (id) => {
    const toast = useToastStore.getState().show
    const result = await unwrap(commands.gitPull(id)).catch((e: Error) => {
      toast(e.message || "Update failed", 4000, "error")
      throw e // let withOp route auth failures to settings / set error state
    })
    set({ repo: await unwrap(commands.gitRepoInfo(id)) })
    if (result.conflicted) {
      await get().loadConflicts(id)
      if (await autoResolveCleanMerge(id)) {
        toast("Got the latest updates", 2500, "success")
      } else {
        toast("Update has conflicts. Resolve first.", 4000, "warning")
      }
    } else if (result.upToDate) {
      toast("You're already up to date", 2500, "info")
      await reloadEverywhere()
      await get().loadChanges(id)
    } else {
      toast("Got the latest updates", 2500, "success")
      await reloadEverywhere()
      await get().loadChanges(id)
    }
    await get().refresh(id)
  })
}

export function share(): Promise<void> {
  return withOp(set, get, "share", async (id) => {
    const toast = useToastStore.getState().show
    await unwrap(commands.gitPush(id)).catch((e: Error) => {
      toast(e.message || "Push failed", 4000, "error")
      throw e // let withOp route auth failures to settings / set error state
    })
    set({ repo: await unwrap(commands.gitRepoInfo(id)) })
    toast("Changes pushed", 2500, "success")
  })
}

/** Roll one entity back to the last published version. */
export async function discardEntity(path: string): Promise<void> {
  const id = get().loadedWorkspaceId
  if (!id) return
  await unwrap(commands.gitDiscard(id, [path]))
  await reloadEverywhere()
  await get().loadChanges(id)
  await get().refresh(id)
}

/** Roll back just one field, keeping the entity's other changes. */
export async function discardField(
  entity: EntityChange,
  key: string,
): Promise<void> {
  const id = get().loadedWorkspaceId
  if (!id) return
  const reverted = revertFieldEntity(entity, key)
  if (!reverted) return
  await unwrap(
    commands.gitResolveEntity(
      id,
      entity.path,
      reverted as GitEntity_Deserialize,
    ),
  )
  await reloadEverywhere()
  await get().loadChanges(id)
  await get().refresh(id)
}

export async function resolveEntity(
  entity: ConflictEntity,
  choice: Record<string, Choice>,
): Promise<void> {
  const id = get().loadedWorkspaceId
  if (!id) return
  const merged = mergeChoice(entity, choice)
  if (merged === null) {
    await unwrap(commands.gitResolveDelete(id, entity.path))
  } else {
    await unwrap(
      commands.gitResolveEntity(
        id,
        entity.path,
        merged as GitEntity_Deserialize,
      ),
    )
  }
  set({
    entityConflicts: get().entityConflicts.filter(
      (c) => c.path !== entity.path,
    ),
  })
}

async function applyFinishMerge(
  id: string,
  message: string,
  author?: { name: string; email: string },
): Promise<void> {
  await unwrap(
    commands.gitFinishMerge(
      id,
      message,
      author?.name ?? null,
      author?.email ?? null,
    ),
  )
  await reloadEverywhere()
  set({ entityConflicts: [], repo: await unwrap(commands.gitRepoInfo(id)) })
  await get().loadChanges(id)
  await get().refresh(id)
}

export function finishMerge(
  message: string,
  author?: { name: string; email: string },
): Promise<void> {
  return withOp(set, get, "merge", (id) =>
    applyFinishMerge(id, message, author),
  )
}

async function autoResolveCleanMerge(id: string): Promise<boolean> {
  if (!(get().repo?.hasAuthor ?? true)) return false
  const folders = useRequestStore
    .getState()
    .folders.map((f) => ({ id: f.id, name: f.name }))
  const entities = buildConflictEntities(get().entityConflicts, folders)
  if (entities.length === 0) return false
  if (entities.some((e) => e.conflicts.length > 0)) return false
  for (const e of entities) await resolveEntity(e, {})
  await applyFinishMerge(id, "Merge remote changes")
  return true
}
