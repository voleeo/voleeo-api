import { emit } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { save } from "@tauri-apps/plugin-dialog"
import { create } from "zustand"
import { EVENTS } from "@/config/events"
import { errorMessage } from "@/lib/error"
import { useUiStore } from "@/store/workspace"
import {
  commands,
  type ExportFormat,
  type ExportTarget,
} from "../../../packages/types/bindings"

type ExportStore = {
  targets: ExportTarget[]
  selectedIds: Set<string>
  format: ExportFormat
  includeEnvironments: boolean
  includePrivate: boolean
  exportProto: boolean
  exportAsyncapi: boolean
  ack: boolean
  exporting: boolean
  loaded: boolean
  error: string | null
  previewWarnings: string[]
  loadTargets: () => Promise<void>
  loadPreview: (
    ids: string[],
    format: ExportFormat,
    includeEnvironments: boolean,
    includePrivate: boolean,
    exportProto: boolean,
  ) => Promise<void>
  toggle: (id: string) => void
  toggleAll: () => void
  setFormat: (f: ExportFormat) => void
  setIncludeEnvironments: (v: boolean) => void
  setIncludePrivate: (v: boolean) => void
  setExportProto: (v: boolean) => void
  setExportAsyncapi: (v: boolean) => void
  setAck: (v: boolean) => void
  runExport: () => Promise<void>
}

export const useExportStore = create<ExportStore>((set, get) => ({
  targets: [],
  selectedIds: new Set(),
  format: "voleeo",
  includeEnvironments: false,
  includePrivate: false,
  exportProto: true,
  exportAsyncapi: true,
  ack: false,
  exporting: false,
  loaded: false,
  error: null,
  previewWarnings: [],

  loadTargets: async () => {
    const res = await commands.exportSummary()
    if (res.status !== "ok") {
      set({ error: errorMessage(res.error), loaded: true })
      return
    }
    const active =
      new URLSearchParams(window.location.search).get("workspaceId") ??
      useUiStore.getState().activeWorkspaceId

    const selectedIds = new Set<string>()
    if (active && res.data.some((t) => t.id === active)) selectedIds.add(active)
    set({ targets: res.data, selectedIds, loaded: true })
  },

  loadPreview: async (
    ids,
    format,
    includeEnvironments,
    includePrivate,
    exportProto,
  ) => {
    if (ids.length === 0) {
      set({ previewWarnings: [] })
      return
    }
    const res = await commands.exportPreview(
      ids,
      format,
      includeEnvironments,
      includePrivate,
      exportProto,
    )
    if (res.status !== "ok") return

    const now = get()
    if (
      now.format !== format ||
      now.includeEnvironments !== includeEnvironments ||
      now.includePrivate !== includePrivate ||
      now.exportProto !== exportProto ||
      now.selectedIds.size !== ids.length ||
      !ids.every((id) => now.selectedIds.has(id))
    )
      return
    set({ previewWarnings: res.data })
  },

  toggle: (id) =>
    set((s) => {
      const next = new Set(s.selectedIds)
      next.has(id) ? next.delete(id) : next.add(id)
      return { selectedIds: next, ack: false }
    }),

  toggleAll: () =>
    set((s) => {
      const all = s.selectedIds.size === s.targets.length
      return {
        selectedIds: all ? new Set() : new Set(s.targets.map((t) => t.id)),
        ack: false,
      }
    }),

  setFormat: (format) => set({ format }),
  setIncludeEnvironments: (includeEnvironments) =>
    set({ includeEnvironments, ack: false }),
  setIncludePrivate: (includePrivate) => set({ includePrivate, ack: false }),
  setExportProto: (exportProto) => set({ exportProto }),
  setExportAsyncapi: (exportAsyncapi) => set({ exportAsyncapi }),
  setAck: (ack) => set({ ack }),

  runExport: async () => {
    const {
      selectedIds,
      format,
      includeEnvironments,
      includePrivate,
      exportProto,
      exportAsyncapi,
    } = get()
    if (selectedIds.size === 0) return

    const dest =
      format === "voleeo"
        ? await save({
            defaultPath: "voleeo-export.voleeo.yaml",
            filters: [
              { name: "Voleeo Bundle", extensions: ["voleeo", "yaml", "yml"] },
            ],
          })
        : await save({
            defaultPath: "voleeo-export.postman_collection.json",
            filters: [{ name: "JSON", extensions: ["json"] }],
          })
    if (typeof dest !== "string") return

    set({ exporting: true, error: null })
    const res = await commands.exportWorkspaces(
      [...selectedIds],
      format,
      includeEnvironments,
      includePrivate,
      exportProto,
      exportAsyncapi,
      dest,
    )
    if (res.status !== "ok") {
      set({ exporting: false, error: errorMessage(res.error) })
      return
    }

    const count = selectedIds.size
    const fmt = format === "voleeo" ? "Voleeo Bundle" : "Postman"
    await emit(EVENTS.exportToast, {
      message: `Exported ${count} workspace${count === 1 ? "" : "s"} as ${fmt}`,
      kind: "success",
    })
    await getCurrentWindow().close()
  },
}))
