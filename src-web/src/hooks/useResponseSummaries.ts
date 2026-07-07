import { listen } from "@tauri-apps/api/event"
import { useEffect, useRef, useState } from "react"
import { EVENTS } from "@/config/events"
import { commands } from "../../../packages/types/bindings"

export interface ResponseSummary {
  status: number
  totalMs: number
}

type StoredEvent = { workspaceId: string; requestId: string }

/** Last stored response summary per request id. Fetches each id once, then
 * stays fresh via response:stored / mcp:response-stored / response:cleared —
 * shared by the request tree dots and the folder-run panel. */
export function useResponseSummaries(
  workspaceId: string | null,
  ids: string[],
): Record<string, ResponseSummary> {
  const [summaries, setSummaries] = useState<Record<string, ResponseSummary>>(
    {},
  )
  const fetchedRef = useRef<{ wsId: string; ids: Set<string> }>({
    wsId: "",
    ids: new Set(),
  })

  useEffect(() => {
    if (!workspaceId) return

    if (fetchedRef.current.wsId !== workspaceId) {
      fetchedRef.current = { wsId: workspaceId, ids: new Set() }
      setSummaries({})
    }

    const missing = ids.filter((id) => !fetchedRef.current.ids.has(id))
    if (!missing.length) return
    for (const id of missing) fetchedRef.current.ids.add(id)

    Promise.all(
      missing.map((id) =>
        commands.responseList(workspaceId, id).then((res) =>
          res.status === "ok" && res.data.length > 0
            ? ([
                id,
                {
                  status: res.data[0].status,
                  totalMs: res.data[0].totalMs ?? 0,
                },
              ] as const)
            : null,
        ),
      ),
    ).then((results) => {
      if (fetchedRef.current.wsId !== workspaceId) return
      const next: Record<string, ResponseSummary> = {}
      for (const r of results)
        if (r && fetchedRef.current.ids.has(r[0])) next[r[0]] = r[1]
      if (Object.keys(next).length > 0)
        setSummaries((prev) => ({ ...prev, ...next }))
    })
  }, [workspaceId, ids])

  useEffect(() => {
    if (!workspaceId) return
    let unmounted = false

    const onStored = ({ payload }: { payload: StoredEvent }) => {
      if (unmounted || payload.workspaceId !== workspaceId) return
      commands.responseList(workspaceId, payload.requestId).then((res) => {
        if (unmounted || res.status !== "ok" || !res.data.length) return
        fetchedRef.current.ids.add(payload.requestId)
        setSummaries((prev) => ({
          ...prev,
          [payload.requestId]: {
            status: res.data[0].status,
            totalMs: res.data[0].totalMs ?? 0,
          },
        }))
      })
    }

    const onCleared = ({ payload }: { payload: StoredEvent }) => {
      if (unmounted || payload.workspaceId !== workspaceId) return
      fetchedRef.current.ids.delete(payload.requestId)
      setSummaries((prev) => {
        if (!(payload.requestId in prev)) return prev
        const next = { ...prev }
        delete next[payload.requestId]
        return next
      })
    }

    const unlisteners: (() => void)[] = []
    const track = (p: Promise<() => void>) =>
      p.then((fn) => {
        if (unmounted) fn()
        else unlisteners.push(fn)
      })
    track(listen<StoredEvent>(EVENTS.responseStored, onStored))
    track(listen<StoredEvent>(EVENTS.mcpResponseStored, onStored))
    track(listen<StoredEvent>(EVENTS.responseCleared, onCleared))
    return () => {
      unmounted = true
      for (const fn of unlisteners) fn()
    }
  }, [workspaceId])

  return summaries
}
