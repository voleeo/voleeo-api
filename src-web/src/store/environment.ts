import { create } from "zustand"
import { errorMessage } from "@/lib/error"
import { getCachedSettings, patchSettings } from "@/lib/workspaceSettings"
import type {
  Environment,
  EnvironmentVariable,
} from "../../../packages/types/bindings"
import { commands } from "../../../packages/types/bindings"

export type { Environment, EnvironmentVariable }

interface EnvironmentStore {
  environments: Environment[]
  loadedWorkspaceId: string | null
  isLoading: boolean
  error: string | null
  activeEnvId: string | null

  load: (workspaceId: string) => Promise<void>
  /** Force re-fetch for the currently loaded workspace (used by MCP sync). */
  reload: () => Promise<void>
  create: (
    workspaceId: string,
    input: { name: string; color: string; shared: boolean },
  ) => Promise<Environment>
  update: (env: Environment) => Promise<Environment>
  remove: (workspaceId: string, id: string) => Promise<void>
  setActive: (workspaceId: string, envId: string | null) => void
  reset: () => void
}

export const useEnvironmentStore = create<EnvironmentStore>((set) => ({
  environments: [],
  loadedWorkspaceId: null,
  isLoading: false,
  error: null,
  activeEnvId: null,

  load: async (workspaceId: string) => {
    set({ isLoading: true, error: null })
    const result = await commands.envList(workspaceId)
    if (result.status === "error") {
      set({
        isLoading: false,
        error: errorMessage(result.error) ?? "Failed to load environments",
      })
      return
    }
    const environments = result.data
    const storedActiveId = getCachedSettings(workspaceId).activeEnvId ?? null
    // Validate the stored active env still exists (and is not the global env)
    const activeEnvId =
      storedActiveId &&
      environments.some((e) => e.id === storedActiveId && e.kind !== "global")
        ? storedActiveId
        : null
    set({
      environments,
      loadedWorkspaceId: workspaceId,
      isLoading: false,
      activeEnvId,
    })
  },

  reload: async () => {
    const { loadedWorkspaceId: workspaceId } = useEnvironmentStore.getState()
    if (!workspaceId) return
    const result = await commands.envList(workspaceId)
    if (result.status === "ok") {
      const environments = result.data
      set((s) => ({
        environments,
        // Re-validate: the active env may have been deleted remotely.
        activeEnvId:
          s.activeEnvId &&
          environments.some(
            (e) => e.id === s.activeEnvId && e.kind !== "global",
          )
            ? s.activeEnvId
            : null,
      }))
    }
  },

  create: async (workspaceId, { name, color, shared }) => {
    const result = await commands.envCreate(workspaceId, name, color, shared)
    if (result.status === "error") {
      throw new Error(
        errorMessage(result.error) ?? "Failed to create environment",
      )
    }
    const env = result.data
    set((s) => ({ environments: [...s.environments, env] }))
    return env
  },

  update: async (env) => {
    const result = await commands.envUpdate(env)
    if (result.status === "error") {
      throw new Error(
        errorMessage(result.error) ?? "Failed to update environment",
      )
    }
    const updated = result.data
    set((s) => ({
      environments: s.environments.map((e) =>
        e.id === updated.id ? updated : e,
      ),
    }))
    return updated
  },

  remove: async (workspaceId, id) => {
    const result = await commands.envDelete(workspaceId, id)
    if (result.status === "error") {
      throw new Error(
        errorMessage(result.error) ?? "Failed to delete environment",
      )
    }
    set((s) => {
      const environments = s.environments.filter((e) => e.id !== id)
      // If the deleted env was active, clear active
      const activeEnvId = s.activeEnvId === id ? null : s.activeEnvId
      if (activeEnvId !== s.activeEnvId) {
        patchSettings(workspaceId, { activeEnvId: null })
      }
      return { environments, activeEnvId }
    })
  },

  setActive: (workspaceId, envId) => {
    patchSettings(workspaceId, { activeEnvId: envId })
    set({ activeEnvId: envId })
  },

  reset: () => {
    set({
      environments: [],
      loadedWorkspaceId: null,
      isLoading: false,
      error: null,
      activeEnvId: null,
    })
  },
}))
