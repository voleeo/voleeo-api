import { listen } from "@tauri-apps/api/event"
import { useEffect, useMemo, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { EVENTS } from "@/config/events"
import { useHttpStore } from "@/store/http"
import type { TreeNode } from "@/store/requests"
import { commands } from "../../../../packages/types/bindings"

function collectRequestIds(nodes: TreeNode[]): string[] {
  const ids: string[] = []
  for (const n of nodes) {
    if (n.kind === "request") ids.push(n.request.id)
    else if (n.kind === "folder") ids.push(...collectRequestIds(n.children))
  }
  return ids
}

export function useRequestStatuses(
  workspaceId: string,
  tree: TreeNode[],
): Record<string, number> {
  const [persistedStatuses, setPersistedStatuses] = useState<
    Record<string, number>
  >({})

  const statusFetchRef = useRef<{ wsId: string; ids: Set<string> }>({
    wsId: "",
    ids: new Set(),
  })

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false

    if (statusFetchRef.current.wsId !== workspaceId) {
      statusFetchRef.current = { wsId: workspaceId, ids: new Set() }
      setPersistedStatuses({})
    }

    const ids = collectRequestIds(tree)
    const missing = ids.filter((id) => !statusFetchRef.current.ids.has(id))
    if (!missing.length) return
    for (const id of missing) statusFetchRef.current.ids.add(id)

    Promise.all(
      missing.map((id) =>
        commands
          .responseList(workspaceId, id)
          .then((res) =>
            res.status === "ok" && res.data.length > 0
              ? ([id, res.data[0].status] as const)
              : null,
          ),
      ),
    ).then((results) => {
      if (cancelled) return
      const next: Record<string, number> = {}
      for (const r of results) if (r) next[r[0]] = r[1]
      if (Object.keys(next).length > 0)
        setPersistedStatuses((prev) => ({ ...prev, ...next }))
    })

    return () => {
      cancelled = true
    }
  }, [workspaceId, tree])

  // Listen for newly stored responses and update just that request's status.
  useEffect(() => {
    if (!workspaceId) return
    let unmounted = false
    const handler = ({
      payload,
    }: {
      payload: { workspaceId: string; requestId: string }
    }) => {
      if (unmounted || payload.workspaceId !== workspaceId) return
      commands.responseList(workspaceId, payload.requestId).then((res) => {
        if (unmounted || res.status !== "ok" || !res.data.length) return
        setPersistedStatuses((prev) => ({
          ...prev,
          [payload.requestId]: res.data[0].status,
        }))
      })
    }

    // History cleared for a request → drop its last-status dot.
    const onCleared = ({
      payload,
    }: {
      payload: { workspaceId: string; requestId: string }
    }) => {
      if (unmounted || payload.workspaceId !== workspaceId) return
      statusFetchRef.current.ids.delete(payload.requestId)
      setPersistedStatuses((prev) => {
        if (!(payload.requestId in prev)) return prev
        const next = { ...prev }
        delete next[payload.requestId]
        return next
      })
    }

    let u1: (() => void) | null = null
    let u2: (() => void) | null = null
    let u3: (() => void) | null = null
    listen<{ workspaceId: string; requestId: string }>(
      EVENTS.responseStored,
      handler,
    ).then((fn) => {
      if (unmounted) fn()
      else u1 = fn
    })
    listen<{ workspaceId: string; requestId: string }>(
      EVENTS.mcpResponseStored,
      handler,
    ).then((fn) => {
      if (unmounted) fn()
      else u2 = fn
    })
    listen<{ workspaceId: string; requestId: string }>(
      EVENTS.responseCleared,
      onCleared,
    ).then((fn) => {
      if (unmounted) fn()
      else u3 = fn
    })
    return () => {
      unmounted = true
      u1?.()
      u2?.()
      u3?.()
    }
  }, [workspaceId])

  // Merge with live in-session responses (live takes priority).
  const liveStatuses = useHttpStore(
    useShallow((s) => {
      const out: Record<string, number> = {}
      for (const [id, r] of Object.entries(s.responses)) out[id] = r.status
      return out
    }),
  )
  return useMemo(
    () => ({ ...persistedStatuses, ...liveStatuses }),
    [persistedStatuses, liveStatuses],
  )
}
