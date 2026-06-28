import { WebviewWindow } from "@tauri-apps/api/webviewWindow"

export async function openExportWindow(workspaceId?: string | null) {
  const existing = await WebviewWindow.getByLabel("export").catch(() => null)
  if (existing) {
    await existing.show().catch(() => {})
    await existing.setFocus().catch(() => {})
    return
  }

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
