import { listen } from "@tauri-apps/api/event"
import { useEffect, useState } from "react"
import { EVENTS } from "@/config/events"
import { cn } from "@/lib/utils"
import { GeneralPanel } from "@/settings/GeneralPanel"
import { InterfacePanel } from "@/settings/InterfacePanel"
import { KeyboardPanel } from "@/settings/KeyboardPanel"
import { ThemePanel } from "@/settings/ThemePanel"

type Section = "general" | "interface" | "theme" | "keyboard"

const NAV_ITEMS: { id: Section; label: string }[] = [
  { id: "general", label: "General" },
  { id: "interface", label: "Interface" },
  { id: "theme", label: "Theme" },
  { id: "keyboard", label: "Shortcuts" },
]

function readInitialSection(): Section {
  try {
    const v = new URLSearchParams(window.location.search).get("section")
    if (v && NAV_ITEMS.some((n) => n.id === v)) return v as Section
  } catch {}
  return "general"
}

export function SettingsWindow() {
  const [section, setSection] = useState<Section>(readInitialSection)

  useEffect(() => {
    const unlistenP = listen<{ section: Section }>(
      EVENTS.settingsGotoSection,
      (e) => {
        const next = e.payload.section
        if (NAV_ITEMS.some((n) => n.id === next)) setSection(next)
      },
    )
    return () => {
      void unlistenP.then((unlisten) => unlisten())
    }
  }, [])

  return (
    <div
      className="h-screen grid bg-surface text-fg"
      style={{ gridTemplateColumns: "200px 1fr" }}
    >
      <nav className="flex flex-col py-3 border-r border-border gap-y-1">
        {NAV_ITEMS.map((item) => {
          const active = section === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={cn(
                "text-left mx-2 px-2 py-[6px] rounded-md text-[0.929rem] cursor-pointer border-none outline-none transition-colors",
                active
                  ? "bg-accent/10 text-accent"
                  : "bg-transparent text-muted hover:bg-subtle hover:text-fg",
              )}
            >
              {item.label}
            </button>
          )
        })}
      </nav>
      <main className="px-7 py-6 overflow-y-auto">
        {section === "general" && <GeneralPanel />}
        {section === "interface" && <InterfacePanel />}
        {section === "theme" && <ThemePanel />}
        {section === "keyboard" && <KeyboardPanel />}
      </main>
    </div>
  )
}
