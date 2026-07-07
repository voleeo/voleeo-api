import { useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import type { StoredCookie } from "@/store/cookies"
import { useCookiesStore } from "@/store/cookies"

/** Owns the editor's draft/dirty state and every commit path: blur-commit for
 *  text fields, immediate commit for toggles/segmented controls, and delete. */
export function useCookieDraft(
  cookie: StoredCookie,
  workspaceId: string,
  jarId: string,
) {
  const { saveCookie, deleteCookie } = useCookiesStore(
    useShallow((s) => ({
      saveCookie: s.saveCookie,
      deleteCookie: s.deleteCookie,
    })),
  )
  const [draft, setDraft] = useState<StoredCookie>(cookie)
  const [dirty, setDirty] = useState(false)

  // Reset draft only when a *different* cookie is selected (by id). Depend
  // on `cookie.id` rather than the object reference — the parent rebuilds
  // the cookie list on every reload, so a `[cookie]` dep would wipe
  // in-flight unsaved edits as soon as the store refreshes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: id-only dep is intentional
  useEffect(() => {
    setDraft(cookie)
    setDirty(false)
  }, [cookie.id])

  function patch(p: Partial<StoredCookie>) {
    setDraft((d) => ({ ...d, ...p }))
    setDirty(true)
  }

  // Commit a specific next-cookie snapshot. Pass the value explicitly so we
  // don't race React's pending state update — calling `commit()` right after
  // `setDraft` would still read the old `draft` from this render's closure.
  async function commitWith(next: StoredCookie) {
    if (!next.name.trim() || !next.domain.trim()) return
    const saved = await saveCookie(workspaceId, jarId, next).catch(() => null)
    if (saved) {
      setDraft(saved)
      setDirty(false)
    }
  }

  // Text fields call this on blur: persist the current `draft` if dirty.
  async function commitBlur() {
    if (!dirty) return
    await commitWith(draft)
  }

  // Toggles / segmented controls call this: build the next snapshot and save
  // immediately, no microtask, no stale closure.
  function patchAndSave(p: Partial<StoredCookie>) {
    const next = { ...draft, ...p }
    setDraft(next)
    void commitWith(next)
  }

  async function handleDelete(onDeleted: () => void) {
    await deleteCookie(workspaceId, jarId, cookie.id).catch(() => {})
    onDeleted()
  }

  return { draft, patch, commitBlur, patchAndSave, handleDelete }
}

export function defaultExpiryIso(): string {
  return new Date(Date.now() + 7 * 864e5).toISOString()
}
