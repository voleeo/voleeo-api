import { type RefObject, useCallback, useEffect, useRef, useState } from "react"
import { Glyph } from "@/components/Glyph"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { type DnsOverride, useUiStore, type Workspace } from "@/store/workspace"
import { SelectAllToggle } from "@/views/ApiWorkspace/SelectAllToggle"
import { PanelHeading } from "./PanelHeading"

const EMPTY: DnsOverride[] = []
const COL_STYLE = { gridTemplateColumns: "16px 1fr 1fr 24px" }

/** Validate an IP address (v4 or v6).
 *  Empty / whitespace stays empty so a mid-edit draft doesn't flag. Bare IPv6 is auto-bracketed for the parser. */
function isValidIp(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  const candidate = v.includes(":") && !v.startsWith("[") ? `[${v}]` : v
  return URL.canParse(`http://${candidate}`)
}

function emptyDraft(): DnsOverride {
  return { id: crypto.randomUUID(), enabled: true, hostname: "", address: "" }
}

function isBlank(r: DnsOverride): boolean {
  return r.hostname === "" && r.address === ""
}

function persistable(rows: DnsOverride[]): DnsOverride[] {
  return rows.filter((r) => !isBlank(r))
}

interface Props {
  workspace: Workspace
  commitRef?: RefObject<(() => Promise<void> | void) | null>
}

export function DnsPanel({ workspace, commitRef }: Props) {
  const updateDns = useUiStore((s) => s.updateWorkspaceDnsOverrides)
  const stored = useUiStore(
    (s) =>
      s.workspaces.find((w) => w.id === workspace.id)?.dnsOverrides ?? EMPTY,
  )
  const [rows, setRows] = useState<DnsOverride[]>(() => [
    ...stored,
    emptyDraft(),
  ])

  const lastCommitRef = useRef<Promise<void> | null>(null)
  useEffect(() => {
    if (!commitRef) return
    commitRef.current = () => lastCommitRef.current ?? undefined
    return () => {
      commitRef.current = null
    }
  }, [commitRef])

  const commit = useCallback(
    (next: DnsOverride[]) => {
      const p = (async () => {
        await updateDns(workspace.id, persistable(next))
      })()
      lastCommitRef.current = p
      return p
    },
    [workspace.id, updateDns],
  )

  function patch(id: string, change: Partial<DnsOverride>) {
    setRows((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, ...change } : r))
      const trailing = next[next.length - 1]
      if (trailing && !isBlank(trailing)) next.push(emptyDraft())
      void commit(next)
      return next
    })
  }

  function removeRow(id: string) {
    const next = rows.filter((r) => r.id !== id)
    // Always keep at least one trailing draft.
    if (next.length === 0 || !isBlank(next[next.length - 1])) {
      next.push(emptyDraft())
    }
    setRows(next)
    void commit(next)
  }

  function toggleRow(id: string, enabled: boolean) {
    const next = rows.map((r) => (r.id === id ? { ...r, enabled } : r))
    setRows(next)
    void commit(next)
  }

  const namedRows = rows.filter((r) => !isBlank(r))
  const allEnabled = namedRows.length > 0 && namedRows.every((r) => r.enabled)
  function selectAll(enable: boolean) {
    const next = rows.map((r) => (isBlank(r) ? r : { ...r, enabled: enable }))
    setRows(next)
    void commit(next)
  }

  return (
    <div className="flex flex-col">
      <PanelHeading
        title="DNS"
        description={
          <>
            Route specific hostnames to custom IPs for requests in this
            workspace.
            <br />
            Useful for staging, local mocks, or testing failover without
            touching your hosts file.
          </>
        }
      />

      <div className="pt-3 flex flex-col">
        {rows.map((r) => {
          const trailing = isBlank(r) && r === rows[rows.length - 1]
          const badIp = r.address.trim() !== "" && !isValidIp(r.address)
          return (
            <div
              key={r.id}
              className="group/row grid gap-x-2 py-[3px] items-center border-b border-border/40"
              style={COL_STYLE}
            >
              {trailing ? (
                <span />
              ) : (
                <Checkbox
                  checked={r.enabled}
                  onCheckedChange={(c) => toggleRow(r.id, c === true)}
                />
              )}

              <input
                type="text"
                value={r.hostname}
                onChange={(e) => patch(r.id, { hostname: e.target.value })}
                placeholder="api.example.com"
                spellCheck={false}
                autoComplete="off"
                className={cn(
                  "w-full px-1 py-0.5 bg-transparent border-0 outline-none font-mono text-[0.786rem] text-fg placeholder:text-muted/60",
                  !trailing && !r.enabled && "opacity-40",
                )}
              />

              <input
                type="text"
                value={r.address}
                onChange={(e) => patch(r.id, { address: e.target.value })}
                placeholder="127.0.0.1"
                spellCheck={false}
                autoComplete="off"
                title={badIp ? "Not a valid IPv4 or IPv6 address" : undefined}
                className={cn(
                  "w-full px-1 py-0.5 bg-transparent border-0 outline-none font-mono text-[0.786rem] placeholder:text-muted/60",
                  badIp ? "text-error" : "text-fg",
                  !trailing && !r.enabled && "opacity-40",
                )}
              />

              {trailing ? (
                <span />
              ) : (
                <button
                  type="button"
                  onClick={() => removeRow(r.id)}
                  title="Remove override"
                  aria-label="Remove override"
                  className="w-6 h-6 flex items-center justify-center rounded-[4px] bg-transparent border-0 outline-none cursor-pointer text-muted opacity-0 group-hover/row:opacity-100 hover:text-error transition-opacity"
                >
                  <Glyph kind="trash" size={12} color="currentColor" />
                </button>
              )}
            </div>
          )
        })}

        {namedRows.length > 0 && (
          <SelectAllToggle allEnabled={allEnabled} onChange={selectAll} />
        )}
      </div>
    </div>
  )
}
