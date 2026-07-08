import { MethodPill } from "@/components/MethodPill"

export function UrlHeadline({
  method,
  fullUrl,
}: {
  method: string
  fullUrl: string
}) {
  // Split base from query for the dimmed-tail effect.
  const qIdx = fullUrl.indexOf("?")
  const base = qIdx === -1 ? fullUrl : fullUrl.slice(0, qIdx)
  const query = qIdx === -1 ? "" : fullUrl.slice(qIdx)
  return (
    <div className="flex items-baseline gap-2.5">
      <MethodPill method={method} />
      <div className="flex-1 min-w-0 font-mono text-[0.929rem] leading-[1.5] text-fg break-all">
        {base}
        {query && <span className="text-muted/70">{query}</span>}
      </div>
    </div>
  )
}
