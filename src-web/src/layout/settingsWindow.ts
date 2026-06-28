import { emit } from "@tauri-apps/api/event"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { EVENTS } from "@/config/events"

export async function openSettingsWindow(section?: string) {
  const existing = await WebviewWindow.getByLabel("settings").catch(() => null)
  if (existing) {
    await existing.show().catch(() => {})
    await existing.setFocus().catch(() => {})
    if (section)
      await emit(EVENTS.settingsGotoSection, { section }).catch(() => {})
    return
  }

  new WebviewWindow("settings", {
    url: section ? `/?section=${section}` : "/",
    title: "Settings",
    width: 900,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    resizable: true,
  })
}
