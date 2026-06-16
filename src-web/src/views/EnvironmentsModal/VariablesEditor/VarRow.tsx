import type React from "react"
import { memo, useMemo } from "react"
import { EncryptedInput } from "@/components/EncryptedInput"
import { Glyph } from "@/components/Glyph"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import type { Row } from "./types"

function DropLine() {
  return (
    <div className="h-[2px] bg-dnd-drop-line rounded-full my-px pointer-events-none" />
  )
}

const COL_STYLE: React.CSSProperties = {
  gridTemplateColumns: "16px 8px 1fr 1fr 24px",
}

export interface VarRowProps {
  v: Row
  idx: number
  isTrailing: boolean
  isTouched: boolean
  isDragging: boolean
  keyError: string | null
  isDuplicate: boolean
  dropIndex: number | null
  onStartDrag: (e: React.PointerEvent<HTMLDivElement>, idx: number) => void
  onUpdateKey: (rowId: number, key: string) => void
  onUpdateValue: (rowId: number, value: string) => void
  onToggleEnabled: (rowId: number) => void
  onSetEncrypted: (rowId: number, encrypted: boolean) => void
  onRemove: (rowId: number) => void
  onKeyFocus: (rowId: number, currentKey: string) => void
  onKeyBlur: (rowId: number, newKey: string) => void
  focusKey?: string
}

export const VarRow = memo(function VarRow({
  v,
  idx,
  isTrailing,
  isTouched,
  isDragging,
  keyError,
  isDuplicate,
  dropIndex,
  onStartDrag,
  onUpdateKey,
  onUpdateValue,
  onToggleEnabled,
  onSetEncrypted,
  onRemove,
  onKeyFocus,
  onKeyBlur,
  focusKey,
}: VarRowProps) {
  // Stable reference — prevents TemplateInput from treating a new array as a dep change.
  const excludeVarKeys = useMemo(() => (v.key ? [v.key] : undefined), [v.key])

  return (
    <div {...(!isTrailing && { "data-list-index": idx })}>
      {dropIndex === idx && !isTrailing && <DropLine />}

      <div
        className={cn(
          "group/row grid gap-x-1 py-[3px] items-center border-b border-border/40 transition-opacity",
          isDragging && "opacity-40",
        )}
        style={COL_STYLE}
      >
        {isTrailing ? (
          <span />
        ) : (
          <Checkbox
            checked={v.enabled}
            onCheckedChange={() => onToggleEnabled(v._rowId)}
          />
        )}

        {isTrailing ? (
          <span />
        ) : (
          <div
            className="flex items-center justify-center opacity-0 group-hover/row:opacity-100 cursor-grab active:cursor-grabbing transition-opacity touch-none -mx-1"
            onPointerDown={(e) => onStartDrag(e, idx)}
          >
            <Glyph kind="drag-handle" size={12} color="var(--base04)" />
          </div>
        )}

        <div className="relative group/key min-w-0">
          <input
            value={v.key}
            onChange={(e) => onUpdateKey(v._rowId, e.target.value)}
            onFocus={() => onKeyFocus(v._rowId, v.key)}
            onBlur={(e) => onKeyBlur(v._rowId, e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="VARIABLE_NAME"
            className={cn(
              "w-full font-mono text-[0.786rem] bg-transparent outline-none px-1 py-0.5 select-text placeholder:text-muted/40 transition-opacity",
              !isTrailing && !v.enabled && "opacity-40",
              keyError || isDuplicate ? "text-error" : "text-fg",
            )}
          />
          {keyError && (
            <div className="absolute top-full left-1 z-10 mt-0.5 rounded-[3px] border border-error/30 bg-bg px-1.5 py-[2px] font-mono text-[0.643rem] text-error shadow-sm pointer-events-none whitespace-nowrap hidden group-hover/key:block">
              {keyError}
            </div>
          )}
          {isDuplicate && (
            <div className="absolute top-full left-1 z-10 mt-0.5 rounded-[3px] border border-error/30 bg-bg px-1.5 py-[2px] font-mono text-[0.643rem] text-error shadow-sm pointer-events-none whitespace-nowrap hidden group-hover/key:block">
              already exists in this environment
            </div>
          )}
        </div>

        <EncryptedInput
          value={v.value}
          onChange={(val) => onUpdateValue(v._rowId, val)}
          encrypted={v.encrypted}
          onEncryptedChange={(enc) => onSetEncrypted(v._rowId, enc)}
          placeholder="value"
          excludeVarKeys={excludeVarKeys}
          focusOnMount={focusKey === v.key}
          className={cn(
            "min-w-0 px-1 py-0.5",
            !isTrailing && !v.enabled && "opacity-40",
          )}
        />

        <button
          type="button"
          onClick={() => onRemove(v._rowId)}
          className={cn(
            "flex items-center justify-center w-6 h-6 rounded-[3px] border-0 outline-none cursor-pointer bg-transparent hover:bg-error/10 transition-opacity",
            isTrailing && !isTouched
              ? "invisible pointer-events-none"
              : "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100",
          )}
        >
          <Glyph kind="trash" size={11} color="var(--base08)" />
        </button>
      </div>
    </div>
  )
})
