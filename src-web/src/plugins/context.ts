import { invoke } from "@tauri-apps/api/core"
import type { Context, PluginMeta } from "@voleeo/plugin-api"
import { resolveTemplate } from "@/lib/template"
import { useEnvironmentStore } from "@/store/environment"
import { signAuthHeaders } from "@/store/http"
import { useToastStore } from "@/store/toast"
import { useUiStore } from "@/store/workspace"
import type { AuthConfig, RequestBody } from "../../../packages/types/bindings"
import { usePromptStore } from "./promptStore"
import { registry } from "./registry"

/** Builds the host-side `Context` implementation for a specific plugin.
 *
 * Each plugin gets its own context instance so calls to `ctx.store` and
 * `ctx.log` are automatically namespaced.  The implementation delegates to
 * existing Tauri commands and Zustand stores — plugins never call these
 * directly.
 */
export function createContext(meta: PluginMeta): Context {
  const pluginId = meta.id

  function tag(...args: unknown[]): unknown[] {
    return [`[plugin:${pluginId}]`, ...args]
  }

  return {
    toast: {
      show({ message, kind = "info" }) {
        useToastStore.getState().show(message, undefined, kind)
      },
    },

    clipboard: {
      async copyText(text) {
        await navigator.clipboard.writeText(text)
      },
    },

    prompt: {
      async text({ title, label, defaultValue }) {
        // Fallback to the browser prompt until a proper modal is wired up.
        const result = window.prompt(label ?? title, defaultValue ?? "")
        return result
      },
      async ask(opts) {
        return usePromptStore.getState().request(opts)
      },
    },

    store: {
      async get<T>(key: string): Promise<T | undefined> {
        // The Rust side stores values as opaque JSON strings (set() stringifies
        // before sending); parse on read so callers get the original shape back.
        const raw = await invoke<string | null>("plugin_store_get", {
          pluginId,
          key,
        }).catch(() => null)
        if (raw === null || raw === undefined) return undefined
        try {
          return JSON.parse(raw) as T
        } catch (e) {
          console.warn(...tag(`store.get("${key}") failed to parse:`, e))
          return undefined
        }
      },
      async set<T>(key: string, value: T): Promise<void> {
        const json = JSON.stringify(value)
        await invoke("plugin_store_set", { pluginId, key, value: json })
      },
      async delete(key: string): Promise<void> {
        await invoke("plugin_store_delete", { pluginId, key })
      },
    },

    workspace: {
      currentId() {
        return useUiStore.getState().activeWorkspaceId
      },
    },

    templates: {
      async render<T>(value: T): Promise<T> {
        // Resolve any {{ … }} expressions inside `value`. Strings are
        // resolved directly; arrays/plain objects are walked recursively.
        // Other primitives pass through unchanged.
        const env = useEnvironmentStore.getState()
        const globalVars =
          env.environments.find((e) => e.kind === "global")?.variables ?? []
        const personalVars =
          env.environments.find((e) => e.id === env.activeEnvId)?.variables ??
          []
        const personalKeys = new Set(personalVars.map((v) => v.key))
        const vars = [
          ...personalVars,
          ...globalVars.filter((v) => !personalKeys.has(v.key)),
        ]
        const fns = registry.templateFunctions()
        return (await renderDeep(value, vars, fns)) as T
      },
    },

    auth: {
      async signDynamic(auth, req) {
        const rows = await signAuthHeaders(
          auth as AuthConfig,
          req.method,
          req.url,
          (req.body ?? null) as RequestBody | null,
        )
        return rows.map((h) => ({ name: h.name, value: h.value }))
      },
    },

    log: {
      debug: (...args) => console.debug(...tag(...args)),
      info: (...args) => console.info(...tag(...args)),
      warn: (...args) => console.warn(...tag(...args)),
      error: (...args) => console.error(...tag(...args)),
    },
  }
}

async function renderDeep(
  value: unknown,
  vars: Parameters<typeof resolveTemplate>[1],
  fns: Parameters<typeof resolveTemplate>[2],
): Promise<unknown> {
  if (typeof value === "string") return resolveTemplate(value, vars, fns)
  if (Array.isArray(value))
    return Promise.all(value.map((v) => renderDeep(v, vars, fns)))
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value))
      out[k] = await renderDeep(v, vars, fns)
    return out
  }
  return value
}
