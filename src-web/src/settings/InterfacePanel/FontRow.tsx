import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  DEFAULT_FONT_FAMILY,
  defaultLabel,
  FONT_SIZES,
  triggerCls,
} from "./shared"

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

export function FontRow({
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
