import type {
  Context,
  PluginMeta,
  Theme,
  VoleeoPlugin,
} from "@voleeo/plugin-api"
import { withInheritedGrpcData } from "@/store/grpc/shared"
import { withInheritedData } from "@/views/ApiWorkspace/sendResolution/effectiveRequest"
import type {
  BoundGrpcRequestAction,
  BoundRequestAction,
  BoundTemplateFunction,
} from "./types"

interface LoadedPlugin {
  plugin: VoleeoPlugin
  ctx: Context
}

type RegistryListener = () => void

class PluginRegistry {
  private plugins = new Map<string, LoadedPlugin>()
  private listeners = new Set<RegistryListener>()

  private cache = new Map<string, unknown>()

  async register(plugin: VoleeoPlugin, ctx: Context): Promise<void> {
    if (this.plugins.has(plugin.meta.id)) {
      await this.unregister(plugin.meta.id)
    }
    if (plugin.init) {
      try {
        await plugin.init(ctx)
      } catch (e) {
        console.error(`[plugin:${plugin.meta.id}] init() threw:`, e)
      }
    }
    this.plugins.set(plugin.meta.id, { plugin, ctx })
    this.emit()
  }

  async unregister(id: string): Promise<void> {
    const loaded = this.plugins.get(id)
    if (!loaded) return
    if (loaded.plugin.dispose) {
      try {
        await loaded.plugin.dispose()
      } catch (e) {
        console.error(`[plugin:${id}] dispose() threw:`, e)
      }
    }
    this.plugins.delete(id)
    this.emit()
  }

  getPlugins(): ReadonlyMap<string, { meta: PluginMeta }> {
    return new Map(
      [...this.plugins.entries()].map(([id, { plugin }]) => [
        id,
        { meta: plugin.meta },
      ]),
    )
  }

  themes(): Theme[] {
    return this.cached("themes", () => this.flatMap((p) => p.themes ?? []))
  }

  requestActions(): BoundRequestAction[] {
    return this.cached("requestActions", () => {
      const out: BoundRequestAction[] = []
      for (const { plugin, ctx } of this.plugins.values()) {
        for (const action of plugin.requestActions ?? []) {
          out.push({
            id: action.id,
            label: action.label,
            glyph: action.glyph,
            isEnabled: action.isEnabled,
            onInvoke: (request) =>
              action.onInvoke(ctx, withInheritedData(request)),
          })
        }
      }
      return out
    })
  }

  grpcRequestActions(): BoundGrpcRequestAction[] {
    return this.cached("grpcRequestActions", () => {
      const out: BoundGrpcRequestAction[] = []
      for (const { plugin, ctx } of this.plugins.values()) {
        for (const action of plugin.grpcRequestActions ?? []) {
          out.push({
            id: action.id,
            label: action.label,
            glyph: action.glyph,
            isEnabled: action.isEnabled,
            onInvoke: (request) =>
              action.onInvoke(ctx, withInheritedGrpcData(request)),
          })
        }
      }
      return out
    })
  }

  templateFunctions(): BoundTemplateFunction[] {
    return this.cached("templateFunctions", () => {
      const out: BoundTemplateFunction[] = []
      for (const { plugin, ctx } of this.plugins.values()) {
        for (const fn of plugin.templateFunctions ?? []) {
          // Adapt the plugin-facing `(ctx, args)` shape to the host-facing
          // `(args)` shape, binding the plugin's own `ctx` in the closure.
          // Each function's side effects (logs, store, toasts) stay
          // namespaced to its owning plugin — and host call sites can't
          // pass the wrong ctx because there's no parameter for it.
          out.push({
            name: fn.name,
            label: fn.label,
            description: fn.description,
            args: fn.args,
            previewable: fn.previewable,
            onRender: (args) => fn.onRender(ctx, args),
            previewRender: fn.previewRender
              ? (args) => fn.previewRender?.(ctx, args) ?? null
              : undefined,
          })
        }
      }
      return out
    })
  }

  subscribe(listener: RegistryListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    this.cache.clear()
    for (const listener of this.listeners) listener()
  }

  private cached<T>(key: string, compute: () => T): T {
    if (this.cache.has(key)) return this.cache.get(key) as T
    const result = compute()
    this.cache.set(key, result)
    return result
  }

  private flatMap<T>(selector: (plugin: VoleeoPlugin) => T[]): T[] {
    const results: T[] = []
    for (const { plugin } of this.plugins.values())
      results.push(...selector(plugin))
    return results
  }
}

/** Singleton registry — the single source of truth for all loaded plugins. */
export const registry = new PluginRegistry()
