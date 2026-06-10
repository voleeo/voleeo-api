import { useEffect, useRef, useState } from "react"
import { ensureResponse } from "@/builtins/response/strategy"
import { FunctionModalShell } from "@/components/FunctionModalShell"
import { FunctionPreviewPane } from "@/components/FunctionPreviewPane"
import { RequestPicker } from "@/components/RequestPicker"
import {
  ResponseFunctionForm,
  type Strategy,
} from "@/components/ResponseFunctionForm"
import { extractBody, extractHeader } from "@/lib/extract"
import { useUiStore } from "@/store/workspace"
import { commands } from "../../../packages/types/bindings"

interface Props {
  fnName: "response.body" | "response.header"
  initialArgs?: Record<string, string>
  onInsert: (args: Record<string, string>) => void
  onClose: () => void
}

export function ResponseFunctionModal({
  fnName,
  initialArgs = {},
  onInsert,
  onClose,
}: Props) {
  const isBody = fnName === "response.body"
  const workspaceId = useUiStore((s) => s.activeWorkspaceId)

  const [requestId, setRequestId] = useState(initialArgs.requestId ?? "")
  const [strategy, setStrategy] = useState<Strategy>(
    (initialArgs.strategy as Strategy) ?? "cache",
  )
  const [ttl, setTtl] = useState(initialArgs.ttl ?? "60")
  const [selector, setSelector] = useState(initialArgs.selector ?? "")
  const [headerName, setHeaderName] = useState(initialArgs.name ?? "")
  const [availableHeaders, setAvailableHeaders] = useState<string[]>([])

  const [testResult, setTestResult] = useState<{
    value: string
    error?: boolean
  } | null>(null)
  const [testing, setTesting] = useState(false)
  const testAbortRef = useRef<AbortController | null>(null)

  // Load available headers when requestId changes (for response.header preview)
  useEffect(() => {
    if (!requestId || !workspaceId || isBody) {
      setAvailableHeaders([])
      return
    }
    let cancelled = false
    ;(async () => {
      const listRes = await commands.responseList(workspaceId, requestId)
      if (cancelled || listRes.status !== "ok" || listRes.data.length === 0)
        return
      const getRes = await commands.responseGet(
        workspaceId,
        requestId,
        listRes.data[0].id,
      )
      if (cancelled || getRes.status !== "ok" || !getRes.data) return
      setAvailableHeaders(
        getRes.data.response.headers.map((h: { name: string }) => h.name),
      )
    })()
    return () => {
      cancelled = true
    }
  }, [requestId, workspaceId, isBody])

  // Auto-preview whenever the relevant fields change (debounced for text inputs).
  // biome-ignore lint/correctness/useExhaustiveDependencies: handleTest and isBody are non-stable; deps are the values that should trigger re-run
  useEffect(() => {
    const previewKey = isBody ? selector : headerName
    const timer = setTimeout(
      () => void handleTest(),
      previewKey !== "" ? 300 : 0,
    )
    return () => clearTimeout(timer)
  }, [requestId, selector, headerName])

  async function handleTest() {
    if (!requestId || !workspaceId) return
    testAbortRef.current?.abort()
    const ac = new AbortController()
    testAbortRef.current = ac
    setTesting(true)
    setTestResult(null)
    try {
      // Preview always uses "cache" — never fires a live request from the modal.
      const stored = await ensureResponse(
        workspaceId,
        requestId,
        "cache",
        Number(ttl) || 60,
      )
      if (ac.signal.aborted) return
      const value = isBody
        ? extractBody(stored.response.body, selector)
        : extractHeader(stored.response.headers, headerName)
      setTestResult({ value: value || "(empty)" })
    } catch (err) {
      if (!ac.signal.aborted)
        setTestResult({
          value: err instanceof Error ? err.message : String(err),
          error: true,
        })
    } finally {
      if (!ac.signal.aborted) setTesting(false)
    }
  }

  function handleInsert() {
    onInsert({
      requestId,
      strategy,
      ...(strategy === "refresh-after" ? { ttl } : {}),
      ...(isBody ? { selector } : { name: headerName }),
    })
  }

  const canInsert = Boolean(requestId) && (isBody ? true : Boolean(headerName))

  return (
    <FunctionModalShell
      fnName={fnName}
      description={
        isBody
          ? "Use response body of another request"
          : "Use a response header from another request"
      }
      canInsert={canInsert}
      onInsert={handleInsert}
      onClose={onClose}
    >
      <div className="px-4 py-4 flex flex-col gap-3 border-b border-border">
        <div className="flex flex-col gap-1.5">
          <label className="font-sans text-[0.786rem] text-muted font-medium">
            Source request <span className="text-error">*</span>
          </label>
          <RequestPicker
            value={requestId}
            onChange={(id) => {
              setRequestId(id)
              setTestResult(null)
            }}
          />
        </div>

        <ResponseFunctionForm
          isBody={isBody}
          strategy={strategy}
          setStrategy={setStrategy}
          ttl={ttl}
          setTtl={setTtl}
          selector={selector}
          setSelector={setSelector}
          headerName={headerName}
          setHeaderName={setHeaderName}
          availableHeaders={availableHeaders}
          onAnyChange={() => setTestResult(null)}
        />
      </div>

      <FunctionPreviewPane
        result={testResult}
        previewing={testing}
        disabled={!requestId}
        onRerun={() => void handleTest()}
      />
    </FunctionModalShell>
  )
}
