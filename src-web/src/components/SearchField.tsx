import type { Ref } from "react"
import { Glyph } from "@/components/Glyph"
import { cn } from "@/lib/utils"

export function SearchField({
  value,
  onChange,
  placeholder = "Search",
  inputRef,
  onBlur,
  onClear,
  alwaysShowClear = false,
  autoFocus = false,
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  inputRef?: Ref<HTMLInputElement>
  onBlur?: () => void
  onClear?: () => void
  alwaysShowClear?: boolean
  autoFocus?: boolean
  className?: string
}) {
  const clear = () => {
    onChange("")
    onClear?.()
  }
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2 py-[5px] rounded-[4px] bg-subtle",
        className,
      )}
    >
      <Glyph kind="search" size={12} color="var(--base04)" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation()
            clear()
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        className="flex-1 min-w-0 bg-transparent border-none outline-none font-mono text-[0.857rem] text-fg placeholder:text-muted"
      />
      {(value || alwaysShowClear) && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={clear}
          className="flex items-center justify-center w-4 h-4 rounded-[2px] border-0 bg-transparent outline-none cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
        >
          <Glyph kind="x" size={10} color="var(--base04)" />
        </button>
      )}
    </div>
  )
}
