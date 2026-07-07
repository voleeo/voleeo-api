import { useState } from "react"
import { Glyph } from "@/components/Glyph"
import { cn } from "@/lib/utils"
import type { EntityDebugInfo } from "../../../../packages/types/bindings"

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function Row({
  label,
  value,
  mono = true,
  copyable = false,
}: {
  label: string
  value: string
  mono?: boolean
  copyable?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1100)
    } catch {
      /* no-op */
    }
  }
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 items-baseline py-[3px]">
      <span className="font-sans text-[0.786rem] text-muted">{label}</span>
      <span className="flex items-baseline gap-2 min-w-0">
        <span
          className={cn(
            "flex-1 min-w-0 text-[0.786rem] text-fg break-all",
            mono ? "font-mono" : "font-sans",
          )}
        >
          {value || "—"}
        </span>
        {copyable && value && (
          <button
            type="button"
            onClick={copy}
            className="shrink-0 text-muted/70 hover:text-fg cursor-pointer border-0 bg-transparent outline-none"
            aria-label="Copy"
          >
            <Glyph
              kind={copied ? "check" : "copy"}
              size={11}
              color="currentColor"
            />
          </button>
        )}
      </span>
    </div>
  )
}

export function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col">
      <span className="font-sans text-[0.714rem] uppercase tracking-[1.2px] text-muted/70 font-semibold mb-1.5">
        {title}
      </span>
      {children}
    </div>
  )
}

/** Storage + Timestamps sections of the debug modal — on-disk path/size/mtime and entity timestamps. */
export function StorageAndTimestampsSections({
  disk,
  createdAt,
  updatedAt,
}: {
  disk: EntityDebugInfo | null
  createdAt: string | undefined
  updatedAt: string | undefined
}) {
  return (
    <>
      <Section title="Storage">
        <Row label="File name" value={disk?.fileName ?? "…"} copyable />
        <Row label="Path" value={disk?.logicalPath ?? "…"} copyable />
        {disk?.resolvedPath && disk.resolvedPath !== disk.logicalPath && (
          <Row label="Resolved" value={disk.resolvedPath} copyable />
        )}
        {disk?.syncLinkTarget && (
          <Row label="Sync link →" value={disk.syncLinkTarget} copyable />
        )}
        <Row
          label="On disk"
          value={
            disk
              ? disk.exists
                ? `yes · ${fmtSize(disk.sizeBytes ?? 0)}`
                : "no (unsaved)"
              : "…"
          }
          mono={false}
        />
        {disk?.modified && (
          <Row label="Modified" value={disk.modified} mono={false} />
        )}
        {disk?.responseFile && (
          <Row label="Responses" value={disk.responseFile} copyable />
        )}
      </Section>

      {(createdAt || updatedAt) && (
        <Section title="Timestamps">
          {createdAt && <Row label="Created" value={createdAt} mono={false} />}
          {updatedAt && <Row label="Updated" value={updatedAt} mono={false} />}
        </Section>
      )}
    </>
  )
}
