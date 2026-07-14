import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { focusExistingWindow } from "./windowFocus"

export async function openExportWindow(workspaceId?: string | null) {
  if (await focusExistingWindow("export")) return

  const url = workspaceId
    ? `/?workspaceId=${encodeURIComponent(workspaceId)}`
    : "/"

  new WebviewWindow("export", {
    url,
    title: "Export",
    width: 880,
    height: 720,
    minWidth: 600,
    minHeight: 520,
    resizable: true,
  })
}
