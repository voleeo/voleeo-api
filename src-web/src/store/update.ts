import { relaunch } from "@tauri-apps/plugin-process"
import { check, type Update } from "@tauri-apps/plugin-updater"
import { create } from "zustand"
import { useToastStore } from "@/store/toast"

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export type UpdateStatus =
  | "idle"
  | "checking"
  | "downloading"
  | "ready"
  | "upToDate"
  | "error"

interface UpdateStore {
  status: UpdateStatus
  version: string | null
  notes: string | null
  progress: number // 0..1, only meaningful while downloading
  error: string | null

  check: (opts?: { silent?: boolean }) => Promise<void>
  installAndRelaunch: () => Promise<void>
  dismiss: () => void
}

let _pending: Update | null = null

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  status: "idle",
  version: null,
  notes: null,
  progress: 0,
  error: null,

  check: async ({ silent = false } = {}) => {
    const { status } = get()
    if (status === "checking" || status === "downloading" || status === "ready")
      return

    const toast = useToastStore.getState()
    if (!silent) toast.show("Checking for updates…", 2000, "info")
    set({ status: "checking", error: null })

    try {
      const update = await check()
      if (!update) {
        set({ status: "upToDate" })
        if (!silent) toast.show("You're up to date", 2500, "success")
        return
      }

      _pending = update
      set({
        status: "downloading",
        version: update.version,
        notes: update.body ?? null,
        progress: 0,
      })

      let total = 0
      let downloaded = 0
      await update.download((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0
            break
          case "Progress": {
            downloaded += event.data.chunkLength
            if (total <= 0) break
            const next = Math.min(1, downloaded / total)
            // Throttle render churn — only commit ~1% steps.
            set((p) =>
              next - p.progress >= 0.01 || next === 1
                ? { ...p, progress: next }
                : p,
            )
            break
          }
          case "Finished":
            break
        }
      })

      set({ status: "ready", progress: 1 })
    } catch (e) {
      _pending = null
      const message = e instanceof Error ? e.message : String(e)
      set({ status: "error", error: message })
      if (!silent) toast.show(`Update check failed: ${message}`, 4000, "error")
      else console.error("Silent update check failed:", message)
    }
  },

  installAndRelaunch: async () => {
    if (!_pending) return
    try {
      await _pending.install()
      await relaunch()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      set({ status: "error", error: message })
      useToastStore.getState().show(`Install failed: ${message}`, 4000, "error")
    }
  },

  dismiss: () => set({ status: "idle" }),
}))
