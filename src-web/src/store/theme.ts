import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import type { Theme } from "@voleeo/plugin-api"
import { create } from "zustand"
import { EVENTS } from "@/config/events"
import { ThemeIdSchema } from "@/lib/schemas"
import { registry } from "@/plugins/registry"

function findTheme(id: string): Theme | undefined {
  return registry.themes().find((t) => t.id === id)
}

function repositionWindowControls() {
  void invoke("reposition_window_controls").catch(() => {})
}

export function applyThemeToCss(theme: Theme) {
  const root = document.documentElement
  for (const [slot, hex] of Object.entries(theme.palette)) {
    root.style.setProperty(`--${slot}`, hex)
  }
}

type ColorMode = "dark" | "light"

interface ThemeStore {
  activeTheme: Theme | null
  colorMode: ColorMode
  initialize: () => Promise<() => void>
  activateTheme: (id: string) => Promise<void>
  setColorMode: (mode: ColorMode) => Promise<void>
}

export const useThemeStore = create<ThemeStore>(() => ({
  activeTheme: null,
  colorMode: "dark",

  initialize: async () => {
    const allThemes = registry.themes()
    if (allThemes.length === 0) {
      console.error("No themes available — check plugin registry")
      return () => {}
    }

    const [activeId, rawMode] = await Promise.all([
      invoke("theme_get_active")
        .then((raw) => ThemeIdSchema.nullable().catch(null).parse(raw))
        .catch((e) => {
          console.error("Failed to get active theme:", e)
          return null
        }),
      invoke<string>("theme_get_color_mode").catch(() => "dark"),
    ])

    const colorMode: ColorMode = rawMode === "light" ? "light" : "dark"
    const theme = (activeId ? findTheme(activeId) : null) ?? allThemes[0]
    applyThemeToCss(theme)
    repositionWindowControls()
    useThemeStore.setState({ activeTheme: theme, colorMode })

    const unThemeChanged = await listen<{ id: string }>(
      EVENTS.themeChanged,
      (event) => {
        const changed = findTheme(event.payload.id)
        if (changed) {
          applyThemeToCss(changed)
          repositionWindowControls()
          useThemeStore.setState({ activeTheme: changed })
        }
      },
    )

    const unColorModeChanged = await listen<{ mode: string }>(
      EVENTS.colorModeChanged,
      (event) => {
        const mode: ColorMode =
          event.payload.mode === "light" ? "light" : "dark"
        useThemeStore.setState({ colorMode: mode })
      },
    )

    return () => {
      unThemeChanged()
      unColorModeChanged()
    }
  },

  activateTheme: async (id: string) => {
    await invoke("theme_activate", { id }).catch((e) => {
      console.error("Failed to activate theme:", e)
    })
  },

  setColorMode: async (mode: ColorMode) => {
    await invoke("theme_set_color_mode", { mode }).catch((e) => {
      console.error("Failed to set color mode:", e)
    })
  },
}))

export type { ColorMode, Theme }
