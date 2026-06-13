import type { RefObject } from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { AuthConfig } from "@/store/requests"

const NO_AUTH: AuthConfig = { kind: "none" }

export type SetAuth = (
  next: AuthConfig | ((prev: AuthConfig) => AuthConfig),
) => void

interface UseAuthEditorOptions {
  /** Unique id of the entity that owns this auth (request id or folder id), or null when nothing is selected. */
  sourceId: string | null
  /** Current persisted auth from the source. Used to seed local state and to reset on source switch. */
  auth: AuthConfig | undefined | null
  /** Persist a new auth value. Called debounced from `setAuth`, immediately from `commitRef`. */
  onSave: (next: AuthConfig) => Promise<void>
  /** Exposed so the parent pane can flush pending edits before sending or switching. */
  commitRef: RefObject<() => Promise<void>>
}

export function useAuthEditor({
  sourceId,
  auth: sourceAuth,
  onSave,
  commitRef,
}: UseAuthEditorOptions): { auth: AuthConfig; setAuth: SetAuth } {
  const [auth, setAuthState] = useState<AuthConfig>(sourceAuth ?? NO_AUTH)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Expose an immediate flush so parents can await it before sending or switching tabs.
  useEffect(() => {
    commitRef.current = async () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      await onSave(auth)
    }
  })

  const prevIdRef = useRef(sourceId)
  const lastSeenAuthRef = useRef(sourceAuth)
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — fires on id change only
  useEffect(() => {
    if (sourceId === prevIdRef.current) return
    prevIdRef.current = sourceId
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    lastSeenAuthRef.current = sourceAuth
    setAuthState(sourceAuth ?? NO_AUTH)
  }, [sourceId])

  useEffect(() => {
    if (sourceAuth === lastSeenAuthRef.current) return
    lastSeenAuthRef.current = sourceAuth
    if (debounceRef.current) return
    setAuthState(sourceAuth ?? NO_AUTH)
  }, [sourceAuth])

  const setAuth = useCallback<SetAuth>(
    (update) => {
      setAuthState((prev) => {
        const next = typeof update === "function" ? update(prev) : update
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
          debounceRef.current = null
          void onSave(next)
        }, 400)
        return next
      })
    },
    [onSave],
  )

  return { auth, setAuth }
}
