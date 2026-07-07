import type { WorkspaceBehavior } from "@/store/interface"

// Shared 8–22 range covers both pickers (interface chrome and editor surfaces).
export const FONT_SIZES = Array.from({ length: 22 - 8 + 1 }, (_, i) => 8 + i)
export const DEFAULT_INTERFACE_SIZE = 14
export const DEFAULT_EDITOR_SIZE = 12
export const DEFAULT_WORKSPACE_BEHAVIOR: WorkspaceBehavior = "ask"
// Empty string = the system-stack fallback; both pickers use this as default.
export const DEFAULT_FONT_FAMILY = ""

export const BEHAVIORS: {
  value: WorkspaceBehavior
  label: string
  desc: string
}[] = [
  { value: "ask", label: "Ask", desc: "Show a popup to choose each time" },
  {
    value: "current",
    label: "Current window",
    desc: "Always reuse the current window",
  },
  { value: "new", label: "New window", desc: "Always open in a new window" },
]

export const triggerCls = "text-[0.929rem]"

/** Suffixes the default option's label so the user can see at a glance which
 *  value is the baseline. Mirrors the "System default (default)" pattern. */
export function defaultLabel(label: string, isDefault: boolean): string {
  return isDefault ? `${label} (default)` : label
}
