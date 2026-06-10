import { useEffect, useRef, useState } from "react"
import { loadRequest, resolveValue } from "@/builtins/request"
import { FunctionModalShell } from "@/components/FunctionModalShell"
import { FunctionPreviewPane } from "@/components/FunctionPreviewPane"
import { RequestFunctionForm } from "@/components/RequestFunctionForm"
import { RequestPicker } from "@/components/RequestPicker"
import { extractBody, extractHeader } from "@/lib/extract"
import {
  extractPathParams,
  queryParamsOnly,
} from "@/views/ApiWorkspace/paramUtils"
import type { HttpRequest } from "../../../packages/types/bindings"

export type RequestFnName =
  | "request.path"
  | "request.query"
  | "request.header"
  | "request.body"

interface Props {
  fnName: RequestFnName
  initialArgs?: Record<string, string>
  onInsert: (args: Record<string, string>) => void
  onClose: () => void
}

const DESCRIPTIONS: Record<RequestFnName, string> = {
  "request.path": "Read a path param from another request",
  "request.query": "Read a query param from another request",
  "request.header": "Read a header from another request",
  "request.body": "Read the body of another request",
}

function namesForFn(fnName: RequestFnName, req: HttpRequest | null): string[] {
  if (!req) return []
  if (fnName === "request.path") return extractPathParams(req.url)
  if (fnName === "request.query")
    return queryParamsOnly(req.parameters ?? [], req.url)
      .filter((p) => p.enabled !== false)
      .map((p) => p.name)
  if (fnName === "request.header")
    return (req.headers ?? [])
      .filter((h) => h.enabled !== false)
      .map((h) => h.name)
  return []
}

export function RequestFunctionModal({
  fnName,
  initialArgs = {},
  onInsert,
  onClose,
}: Props) {
  const [requestId, setRequestId] = useState(initialArgs.requestId ?? "")
  const [name, setName] = useState(initialArgs.name ?? "")
  const [selector, setSelector] = useState(initialArgs.selector ?? "")
  const [result, setResult] = useState<{
    value: string
    error?: boolean
  } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  let sourceReq: ReturnType<typeof loadRequest> | null = null
  try {
    sourceReq = requestId ? loadRequest(requestId) : null
  } catch {
    sourceReq = null
  }
  const availableNames = namesForFn(fnName, sourceReq)

  // biome-ignore lint/correctness/useExhaustiveDependencies: preview is non-stable (defined in render); deps are the values that should trigger re-run
  useEffect(() => {
    const timer = setTimeout(() => void preview(), 250)
    return () => clearTimeout(timer)
  }, [requestId, name, selector])

  async function preview() {
    if (!requestId) return
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setPreviewing(true)
    setResult(null)
    try {
      const req = loadRequest(requestId)
      let raw: string
      let cycleKey: string
      if (fnName === "request.path") {
        if (!name || !extractPathParams(req.url).includes(name))
          throw new Error(`Path param "${name}" not found`)
        const p = (req.parameters ?? []).find(
          (x) => x.name === name && x.enabled !== false,
        )
        raw = p?.value ?? ""
        cycleKey = `request.path:${requestId}:${name}`
      } else if (fnName === "request.query") {
        const p = queryParamsOnly(req.parameters ?? [], req.url).find(
          (x) => x.name === name && x.enabled !== false,
        )
        if (!p) throw new Error(`Query param "${name}" not found`)
        raw = p.value
        cycleKey = `request.query:${requestId}:${name}`
      } else if (fnName === "request.header") {
        const enabled = (req.headers ?? []).filter((h) => h.enabled !== false)
        raw = extractHeader(enabled, name, { caseInsensitive: true })
        cycleKey = `request.header:${requestId}:${name.toLowerCase()}`
      } else {
        raw = extractBody(req.body?.text ?? "", selector)
        cycleKey = `request.body:${requestId}`
      }
      const value = await resolveValue(raw, cycleKey)
      if (ac.signal.aborted) return
      setResult({ value: value || "(empty)" })
    } catch (err) {
      if (!ac.signal.aborted)
        setResult({
          value: err instanceof Error ? err.message : String(err),
          error: true,
        })
    } finally {
      if (!ac.signal.aborted) setPreviewing(false)
    }
  }

  function handleInsert() {
    onInsert(
      fnName === "request.body" ? { requestId, selector } : { requestId, name },
    )
  }

  function handlePickerChange(id: string) {
    setRequestId(id)
    setName("")
    setResult(null)
  }

  const canInsert =
    Boolean(requestId) && (fnName === "request.body" || Boolean(name))

  return (
    <FunctionModalShell
      fnName={fnName}
      description={DESCRIPTIONS[fnName]}
      canInsert={canInsert}
      onInsert={handleInsert}
      onClose={onClose}
    >
      <div className="px-4 py-4 flex flex-col gap-3 border-b border-border">
        <div className="flex flex-col gap-1.5">
          <label className="font-sans text-[0.786rem] text-muted font-medium">
            Source request <span className="text-error">*</span>
          </label>
          <RequestPicker value={requestId} onChange={handlePickerChange} />
        </div>

        <RequestFunctionForm
          fnName={fnName}
          name={name}
          setName={setName}
          selector={selector}
          setSelector={setSelector}
          hasSourceReq={Boolean(sourceReq)}
          availableNames={availableNames}
          onAnyChange={() => setResult(null)}
        />
      </div>

      <FunctionPreviewPane
        result={result}
        previewing={previewing}
        disabled={!requestId}
        onRerun={() => void preview()}
      />
    </FunctionModalShell>
  )
}
