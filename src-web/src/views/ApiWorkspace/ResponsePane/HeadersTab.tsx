import { Spinner } from "@/components/ui/spinner"
import type {
  HttpResponse,
  HttpResponseHeader,
} from "../../../../../packages/types/bindings"

export function HeadersTab({
  response,
  loading,
}: {
  response: HttpResponse | null
  loading: boolean
}) {
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

  if (response.headers.length === 0) {
    return (
      <div className="px-3.5 py-3 text-xs text-muted font-sans">No headers</div>
    )
  }

  return (
    <div className="flex-1 overflow-auto max-h-full">
      <table className="w-full border-collapse selectable-text">
        <tbody>
          {response.headers.map((h: HttpResponseHeader) => (
            <tr key={`${h.name}:${h.value}`} className="border-b border-border">
              <td
                className="font-mono text-[0.786rem] leading-[1.5] py-2 pl-3.5 pr-4 align-top w-[38%] break-all"
                style={{ color: "var(--base0C)" }}
              >
                {h.name}
              </td>
              <td className="font-mono text-[0.786rem] leading-[1.5] py-2 pr-3.5 align-top text-fg break-all">
                {h.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
