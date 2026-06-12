import { useState } from "react"
import { Glyph } from "@/components/Glyph"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { selectActiveRequest, useRequestStore } from "@/store/requests"
import type { HttpResponse } from "../../../../../packages/types/bindings"

export type CookieRow = { name: string; value: string }

/** Parse a single `Set-Cookie` response header into a name/value pair. */
export function parseSetCookie(raw: string): CookieRow | null {
  const pair = raw.split(";")[0]?.trim() ?? ""
  const eq = pair.indexOf("=")
  if (eq <= 0) return null
  return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() }
}

function collectSentRows(
  response: HttpResponse | null,
  requestHeaders: { name: string; value: string }[],
): CookieRow[] {
  const auto: CookieRow[] = (response?.attachedCookies ?? []).map((c) => ({
    name: c.name,
    value: c.value,
  }))

  const explicit: CookieRow[] = []
  for (const h of requestHeaders) {
    if (h.name.toLowerCase() !== "cookie") continue
    for (const part of h.value.split(";")) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const eq = trimmed.indexOf("=")
      if (eq <= 0) {
        explicit.push({ name: trimmed, value: "" })
      } else {
        explicit.push({
          name: trimmed.slice(0, eq).trim(),
          value: trimmed.slice(eq + 1).trim(),
        })
      }
    }
  }

  const seen = new Set(auto.map((r) => r.name))
  for (const row of explicit) {
    if (!seen.has(row.name)) {
      auto.push(row)
      seen.add(row.name)
    }
  }
  return auto
}

/**
 * Cookies received from the server. We prefer `response.capturedCookies` (the
 * jar's parsed view, which includes Set-Cookie from intermediate redirect hops)
 * and fall back to scanning the final response's headers for older saved
 * responses that predate that field.
 */
export function collectReceivedRows(res: HttpResponse | null): CookieRow[] {
  if (!res) return []
  if (res.capturedCookies && res.capturedCookies.length > 0) {
    return res.capturedCookies.map((c) => ({ name: c.name, value: c.value }))
  }
  return res.headers
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .flatMap((h) => {
      const row = parseSetCookie(h.value)
      return row ? [row] : []
    })
}

function CookieSection({
  title,
  rows,
  defaultOpen = true,
}: {
  title: string
  rows: CookieRow[]
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 cursor-pointer outline-none hover:bg-subtle transition-colors"
      >
        <Glyph
          kind="chevron"
          size={11}
          color="var(--base04)"
          style={{
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 150ms",
            flexShrink: 0,
          }}
        />
        <span className="font-sans text-[0.857rem] font-medium text-fg flex-1 text-left">
          {title}
        </span>
        <span
          className={cn(
            "font-mono text-[0.714rem] px-1.5 py-0.5 rounded-[3px] tabular-nums",
            rows.length > 0 ? "text-fg bg-subtle" : "text-muted",
          )}
        >
          {rows.length}
        </span>
      </button>

      {open &&
        (rows.length === 0 ? (
          <p className="px-3.5 pb-3 pt-1 font-sans text-[0.857rem] italic text-muted">
            No Cookies
          </p>
        ) : (
          <table className="w-full border-collapse selectable-text">
            <tbody>
              {rows.map((row, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: cookies can have duplicate names
                <tr key={i} className="border-t border-border/60">
                  <td
                    className="font-mono text-[0.786rem] leading-[1.5] py-1.5 pl-3.5 pr-4 align-top w-[38%] break-all"
                    style={{ color: "var(--base0C)" }}
                  >
                    {row.name}
                  </td>
                  <td className="font-mono text-[0.786rem] leading-[1.5] py-1.5 pr-3.5 align-top text-fg break-all">
                    {row.value || (
                      <span className="text-muted italic">empty</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </div>
  )
}

export function CookiesTab({
  response,
  loading,
}: {
  response: HttpResponse | null
  loading: boolean
}) {
  const activeRequest = useRequestStore(selectActiveRequest)

  const sentRows = collectSentRows(response, activeRequest?.headers ?? [])
  const receivedRows = collectReceivedRows(response)

  if (loading && !response) {
    return (
      <div className="px-3.5 py-6 flex flex-col items-center gap-3 text-muted">
        <Spinner className="size-5 text-fg" aria-hidden />
        <span className="font-mono text-[0.786rem]">
          Waiting for response...
        </span>
      </div>
    )
  }

  if (!response) {
    return (
      <div className="px-3.5 py-3 text-xs text-muted font-sans">
        Send a request to see the response
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto max-h-full">
      <CookieSection title="Sent Cookies" rows={sentRows} />
      <CookieSection title="Received Cookies" rows={receivedRows} />
    </div>
  )
}
