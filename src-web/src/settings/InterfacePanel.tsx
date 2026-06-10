import { useEffect, useState } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { isMac } from "@/lib/platform"
import { cn } from "@/lib/utils"
import { useInterfaceStore, type WorkspaceBehavior } from "@/store/interface"
import { commands } from "../../../packages/types/bindings"

// Shared 8–22 range covers both pickers (interface chrome and editor surfaces).
const FONT_SIZES = Array.from({ length: 22 - 8 + 1 }, (_, i) => 8 + i)
const DEFAULT_INTERFACE_SIZE = 14
const DEFAULT_EDITOR_SIZE = 12
const DEFAULT_WORKSPACE_BEHAVIOR: WorkspaceBehavior = "ask"
// Empty string = the system-stack fallback; both pickers use this as default.
const DEFAULT_FONT_FAMILY = ""

const BEHAVIORS: { value: WorkspaceBehavior; label: string; desc: string }[] = [
  { value: "ask", label: "Ask", desc: "Show a popup to choose each time" },
  {
    value: "current",
    label: "Current window",
    desc: "Always reuse the current window",
  },
  { value: "new", label: "New window", desc: "Always open in a new window" },
]

const triggerCls = "text-[0.929rem]"

/** Suffixes the default option's label so the user can see at a glance which
 *  value is the baseline. Mirrors the "System default (default)" pattern. */
function defaultLabel(label: string, isDefault: boolean): string {
  return isDefault ? `${label} (default)` : label
}

export function InterfacePanel() {
  const {
    workspaceBehavior,
    fontFamily,
    fontSize,
    editorFontFamily,
    editorFontSize,
    setWorkspaceBehavior,
    setFontFamily,
    setFontSize,
    setEditorFontFamily,
    setEditorFontSize,
  } = useInterfaceStore()

  const [systemFonts, setSystemFonts] = useState<string[]>([])

  // Pull the installed font list once on mount. The enumeration is on a
  // blocking pool in Rust, so the await is cheap on the JS side.
  useEffect(() => {
    let cancelled = false
    commands.listSystemFonts().then((res) => {
      if (cancelled) return
      if (res.status === "ok") setSystemFonts(res.data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section>
      <h2 className="text-[1.286rem] font-semibold mb-1 text-fg">Interface</h2>
      <p className="text-[0.929rem] text-muted mb-6">
        Appearance and behavior of the app shell.
      </p>

      <div className="flex flex-col gap-5">
        {isMac && <CustomTitleBarRow />}

        <div>
          <label className="block text-[0.929rem] text-muted mb-1.5">
            Open workspace in
          </label>
          <Select
            value={workspaceBehavior}
            onValueChange={(v) => {
              if (v) setWorkspaceBehavior(v as WorkspaceBehavior)
            }}
          >
            <SelectTrigger className={cn(triggerCls, "w-full")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BEHAVIORS.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  {defaultLabel(
                    `${b.label} — ${b.desc}`,
                    b.value === DEFAULT_WORKSPACE_BEHAVIOR,
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <FontRow
          label="Interface font"
          desc="Font used for Voleeo interface controls."
          family={fontFamily}
          onFamilyChange={setFontFamily}
          size={fontSize}
          onSizeChange={setFontSize}
          defaultSize={DEFAULT_INTERFACE_SIZE}
          systemFonts={systemFonts}
        />

        <FontRow
          label="Editor font"
          desc="Font used in request and response editors."
          family={editorFontFamily}
          onFamilyChange={setEditorFontFamily}
          size={editorFontSize}
          onSizeChange={setEditorFontSize}
          defaultSize={DEFAULT_EDITOR_SIZE}
          systemFonts={systemFonts}
        />
      </div>
    </section>
  )
}

/** macOS-only: toggles the overlay title bar. The native window chrome is set up
 *  at launch, so flipping this relaunches the app (handled in the Rust command). */
function CustomTitleBarRow() {
  const [enabled, setEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    commands.settingsGetCustomTitleBar().then((res) => {
      if (!cancelled && res.status === "ok") setEnabled(res.data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = (next: boolean) => {
    setEnabled(next)
    commands.settingsSetCustomTitleBar(next)
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <label className="block text-[0.929rem] text-fg font-semibold">
          Custom title bar
        </label>
        <p className="text-[0.857rem] text-muted mt-0.5">
          Window controls in the toolbar instead of a native title bar.
        </p>
      </div>
      <Switch
        checked={enabled ?? false}
        onCheckedChange={toggle}
        disabled={enabled === null}
        size="sm"
      />
    </div>
  )
}

interface FontRowProps {
  label: string
  desc: string
  family: string
  onFamilyChange: (v: string) => void
  size?: number
  onSizeChange?: (v: number) => void
  defaultSize?: number
  systemFonts: string[]
}

function FontRow({
  label,
  desc,
  family,
  onFamilyChange,
  size,
  onSizeChange,
  defaultSize,
  systemFonts,
}: FontRowProps) {
  const FAMILY_DEFAULT = "__default__"
  return (
    <div>
      <label className="block text-[0.929rem] text-fg font-semibold mb-1">
        {label}
      </label>
      <p className="text-[0.857rem] text-muted mb-1.5">{desc}</p>
      <div className="flex gap-2">
        <Select
          value={family === DEFAULT_FONT_FAMILY ? FAMILY_DEFAULT : family}
          onValueChange={(v) => {
            if (v === null) return
            onFamilyChange(v === FAMILY_DEFAULT ? "" : v)
          }}
        >
          <SelectTrigger className={cn(triggerCls, "flex-1")}>
            {/* Base UI's `<SelectValue/>` renders the raw bound value, not the
             * item's label — so the sentinel `__default__` would leak through.
             * Map it back to a readable label here. */}
            <SelectValue>
              {(v: unknown) =>
                v === FAMILY_DEFAULT || !v
                  ? "System default"
                  : typeof v === "string"
                    ? v
                    : ""
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FAMILY_DEFAULT}>System default</SelectItem>
            {systemFonts.map((f) => (
              <SelectItem key={f} value={f}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {size !== undefined && onSizeChange && (
          <Select
            value={String(size)}
            onValueChange={(v) => {
              if (v) onSizeChange(Number(v))
            }}
          >
            <SelectTrigger className={cn(triggerCls, "w-[110px]")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONT_SIZES.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {defaultLabel(String(s), s === defaultSize)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  )
}
