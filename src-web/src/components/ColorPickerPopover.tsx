import { Circle, Colorful } from "@uiw/react-color"
import { useEffect, useMemo, useRef } from "react"

// Palette slots used as presets. They must be resolved to concrete hex before
// reaching @uiw/react-color — its `hexToHsva` can't parse `var(--…)` and silently
// returns black, which is the bug this component used to ship (clicking any
// preset stored #000000). See `resolveCssColor`.
const PRESET_SLOTS = [
  "--base08",
  "--base09",
  "--base0A",
  "--base0B",
  "--base0C",
  "--base0D",
  "--base0E",
  "--base0F",
]

function resolveCssColor(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith("var(")) return trimmed
  const inner = trimmed.slice(4, trimmed.lastIndexOf(")"))
  const name = inner.split(",")[0].trim()
  const resolved = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return resolved || "#000000"
}

interface Props {
  color: string
  /** anchor rect — the popover positions itself relative to this */
  anchorRect: DOMRect
  onChange: (hex: string) => void
  onClose: () => void
}

export function ColorPickerPopover({
  color,
  anchorRect,
  onChange,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  const presetHexes = useMemo(
    () => PRESET_SLOTS.map((slot) => resolveCssColor(`var(${slot})`)),
    [],
  )
  const resolvedColor = useMemo(() => resolveCssColor(color), [color])

  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener("pointerdown", handlePointerDown, true)
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true)
  }, [onClose])

  const GAP = 6
  const top = anchorRect.bottom + GAP
  const rawLeft = anchorRect.left
  // Panel is ~220px wide; keep it inside the viewport
  const left = Math.min(rawLeft, window.innerWidth - 228)

  return (
    <div
      ref={panelRef}
      className="fixed z-500 bg-surface border border-border rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] p-3 flex flex-col gap-3"
      style={{ top, left, width: 220 }}
    >
      <Circle
        colors={presetHexes}
        color={resolvedColor}
        onChange={(c) => onChange(c.hex)}
        pointProps={{
          style: { width: 18, height: 18 },
        }}
        style={{ gap: 6, justifyContent: "center" }}
      />

      <Colorful
        color={resolvedColor}
        disableAlpha
        onChange={(c) => onChange(c.hex)}
        style={{ width: "100%", borderRadius: 6 }}
      />

      <div className="flex items-center gap-2">
        <span
          className="w-5 h-5 rounded-full shrink-0 border border-border"
          style={{ background: resolvedColor }}
        />
        <input
          value={resolvedColor.toUpperCase()}
          onChange={(e) => {
            const v = e.target.value
            if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) onChange(v)
          }}
          spellCheck={false}
          className="font-mono text-[0.857rem] text-fg bg-bg border border-border rounded-[4px] px-2 py-1 outline-none focus:border-accent flex-1 select-text min-w-0"
          maxLength={7}
        />
      </div>
    </div>
  )
}
