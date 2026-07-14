import { emit } from "@tauri-apps/api/event"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { EVENTS } from "@/config/events"
import { focusExistingWindow } from "./windowFocus"

export async function openSettingsWindow(section?: string) {
  if (await focusExistingWindow("settings")) {
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
