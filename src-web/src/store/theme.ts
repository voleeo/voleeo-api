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
  const p = theme.palette
  root.style.setProperty("--base00", p.base00)
  root.style.setProperty("--base01", p.base01)
  root.style.setProperty("--base02", p.base02)
  root.style.setProperty("--base03", p.base03)
  root.style.setProperty("--base04", p.base04)
  root.style.setProperty("--base05", p.base05)
  root.style.setProperty("--base06", p.base06)
  root.style.setProperty("--base07", p.base07)
  root.style.setProperty("--base08", p.base08)
  root.style.setProperty("--base09", p.base09)
  root.style.setProperty("--base0A", p.base0A)
  root.style.setProperty("--base0B", p.base0B)
  root.style.setProperty("--base0C", p.base0C)
  root.style.setProperty("--base0D", p.base0D)
  root.style.setProperty("--base0E", p.base0E)
  root.style.setProperty("--base0F", p.base0F)
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
