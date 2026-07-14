import { WebviewWindow } from "@tauri-apps/api/webviewWindow"

/** Show + focus an already-open window by label. Returns true if one existed
 *  (caller returns early), false if a new window must be constructed. */
export async function focusExistingWindow(label: string): Promise<boolean> {
  const existing = await WebviewWindow.getByLabel(label).catch(() => null)
  if (!existing) return false
  await existing.show().catch(() => {})
  await existing.setFocus().catch(() => {})
  return true
}
