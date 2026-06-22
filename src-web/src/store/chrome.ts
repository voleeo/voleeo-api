import { create } from "zustand"
import { commands } from "../../../packages/types/bindings"

interface ChromeStore {
  customTitleBar: boolean
  init: () => Promise<void>
  toggleMenu: () => Promise<void>
}

export const useChromeStore = create<ChromeStore>((set) => ({
  customTitleBar: true,
  init: async () => {
    const res = await commands.settingsGetCustomTitleBar()
    set({ customTitleBar: res.status === "ok" ? res.data : true })
  },
  toggleMenu: async () => {
    await commands.toggleMainMenu()
  },
}))
