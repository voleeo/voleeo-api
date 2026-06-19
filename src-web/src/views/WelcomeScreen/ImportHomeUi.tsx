import type { ReactNode } from "react"
import { Glyph } from "@/components/Glyph"
import { cn } from "@/lib/utils"

/** Base card styling shared by the import-home option rows. */
export const CARD = "border border-border rounded-[10px] bg-subtle/20 p-4"

// scp-style SSH (git@host:org/repo.git) or an http(s)/ssh/git scheme URL.
const SSH_SCP = /^[\w.+-]+@[\w.-]+:[^\s]+$/
const SCHEME_URL = /^(https?|ssh|git):\/\/[^\s]+$/i

/** Whether `raw` looks like a clonable Git repository URL. */
export function isValidRepoUrl(raw: string): boolean {
  const url = raw.trim()
  return SSH_SCP.test(url) || SCHEME_URL.test(url)
}

/** Uppercase section label above each import option group. */
export function Section({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div>
      <div className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted/70 mb-2">
        {label}
      </div>
      {children}
    </div>
  )
}

/** Square icon tile leading each card; `accent` tints it for the primary action. */
export function IconBox({ kind, accent }: { kind: string; accent?: boolean }) {
  return (
    <div
      className={cn(
        "size-10 rounded-[8px] grid place-items-center shrink-0 border",
        accent ? "border-accent/30 bg-accent/10" : "border-border bg-surface",
      )}
    >
      <Glyph
        kind={kind}
        size={18}
        color={accent ? "var(--base0D)" : "var(--base05)"}
      />
    </div>
  )
}
