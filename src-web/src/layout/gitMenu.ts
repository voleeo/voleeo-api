import { emit } from "@tauri-apps/api/event"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { EVENTS } from "@/config/events"
import { checkoutBranch } from "@/store/gitBranches"
import { useToastStore } from "@/store/toast"
import { focusExistingWindow } from "./windowFocus"

/** Shared className for top-bar dropdown items — source control, cookies, and
 * environments — so all three menus match. Layers over the base DropdownMenuItem
 * (keeps its padding/rounding) and only overrides font, gap, and focus colors. */
export const ITEM =
  "font-sans text-[0.857rem] flex items-center gap-2 focus:bg-subtle focus:text-fg cursor-pointer"

export function switchBranch(workspaceId: string, branch: string) {
  checkoutBranch(workspaceId, branch).catch((e) => {
    useToastStore.getState().show((e as Error).message, 4000, "error")
  })
}

export type GitView = "changes" | "history"

export async function openGitWindow(
  workspaceId: string,
  view: GitView = "changes",
  path?: string,
  name?: string,
) {
  const label = `git-${workspaceId}`
  if (await focusExistingWindow(label)) {
    await emit(EVENTS.gitView, {
      workspaceId,
      view,
      path: path ?? null,
      name: name ?? null,
    }).catch(() => {})
    return
  }
  const params = new URLSearchParams({ workspaceId, view })
  if (path) params.set("path", path)
  if (name) params.set("name", name)
  new WebviewWindow(label, {
    url: `/?${params.toString()}`,
    title: name ? `History — ${name}` : "Changes",
    width: 1100,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    resizable: true,
  })
}
