import { Glyph } from "@/components/Glyph"
import { cn } from "@/lib/utils"

export function SecretWarning({
  count,
  ack,
  onToggleAck,
  embedded = false,
}: {
  count: number
  ack: boolean
  onToggleAck: () => void
  embedded?: boolean
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 bg-warn/10 p-4",
        embedded
          ? "border-t border-warn/30"
          : "rounded-xl border border-warn/30",
      )}
    >
      <span className="mt-0.5 shrink-0 text-warn">
        <Glyph kind="key" size={18} color="currentColor" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold text-fg">
          Secret values are exported as plain text
        </div>
        <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
          {count} encrypted value{count === 1 ? "" : "s"} in this selection{" "}
          {count === 1 ? "is" : "are"} decrypted and written into the export
          file as readable text. Anyone with the file can read them — store and
          share it carefully.
        </div>
        <button
          type="button"
          onClick={onToggleAck}
          className="mt-3 inline-flex cursor-pointer items-center gap-2.5"
        >
          <span
            className={cn(
              "flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors",
              ack ? "border-warn bg-warn text-bg" : "border-[var(--base03)]",
            )}
          >
            {ack && <Glyph kind="check" size={12} color="currentColor" />}
          </span>
          <span className={cn("text-[13px]", ack ? "text-fg" : "text-muted")}>
            I understand secrets will be decrypted
          </span>
        </button>
      </div>
    </div>
  )
}
