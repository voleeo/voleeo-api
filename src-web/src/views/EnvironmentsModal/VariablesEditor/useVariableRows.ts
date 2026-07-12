import { useCallback, useEffect, useRef, useState } from "react"
import { serialize } from "@/lib/template"
import type { EnvironmentVariable } from "@/store/environment"
import { emptyRow, nextRowId, type Row } from "./types"

interface Options {
  source: EnvironmentVariable[]
  updatedAt: string
  onSave: (vars: EnvironmentVariable[]) => void
  onRename: (oldKey: string, newKey: string) => void
}

export function useVariableRows({
  source,
  updatedAt,
  onSave,
  onRename,
}: Options) {
  const [variables, setVariables] = useState<Row[]>(() => [
    ...source.map((v) => ({ ...v, _rowId: nextRowId() })),
    emptyRow(),
  ])
  const touchedRowIds = useRef<Set<number>>(new Set())
  const editingKeyRef = useRef<Map<number, string>>(new Map())
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Resync on external writes; skip mid-save (the incoming change is our echo).
  // Also skip when content is identical (e.g. the Local/Shared toggle bumps
  // updatedAt without touching variables): fresh _rowIds remount every row,
  // which drops focus and — via focusOnMount on a navigated encrypted value —
  // re-reveals it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — keyed on updatedAt timestamp; source.map is read at resync time, not a dep
  useEffect(() => {
    if (saveTimerRef.current !== null) return
    setVariables((prev) => {
      const prevVars = toVars(prev)
      const same =
        prevVars.length === source.length &&
        prevVars.every((v, i) => {
          const s = source[i]
          return (
            v.key === s.key &&
            v.value === s.value &&
            v.encrypted === s.encrypted &&
            v.enabled === s.enabled
          )
        })
      if (same) return prev
      touchedRowIds.current.clear()
      return [...source.map((v) => ({ ...v, _rowId: nextRowId() })), emptyRow()]
    })
  }, [updatedAt])

  function toVars(rows: Row[]): EnvironmentVariable[] {
    return rows
      .filter((r) => r.key !== "" || r.value !== "")
      .map(({ _rowId: _, ...v }) => v)
  }

  // Encrypted values travel plaintext here; the backend encrypts at rest on `env_update`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: toVars is a pure local function with no state closure — safe to omit
  const scheduleSave = useCallback(
    (rows: Row[]) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        onSave(toVars(rows))
      }, 400)
    },
    [onSave],
  )

  const commitRows = useCallback(
    (updater: (prev: Row[]) => Row[]) => {
      setVariables((prev) => {
        const next = updater(prev)
        scheduleSave(next)
        return next
      })
    },
    [scheduleSave],
  )

  const updateKey = useCallback(
    (rowId: number, key: string) => {
      if (key !== "") touchedRowIds.current.add(rowId)
      commitRows((prev) => {
        const next = prev.map((v) => (v._rowId === rowId ? { ...v, key } : v))
        const isLast = prev[prev.length - 1]._rowId === rowId
        return isLast && key !== "" ? [...next, emptyRow()] : next
      })
    },
    [commitRows],
  )

  const updateValue = useCallback(
    (rowId: number, value: string) => {
      if (value !== "") touchedRowIds.current.add(rowId)
      commitRows((prev) => {
        const next = prev.map((v) => (v._rowId === rowId ? { ...v, value } : v))
        const isLast = prev[prev.length - 1]._rowId === rowId
        return isLast && value !== "" ? [...next, emptyRow()] : next
      })
    },
    [commitRows],
  )

  const setEncrypted = useCallback(
    (rowId: number, encrypted: boolean) => {
      commitRows((prev) =>
        prev.map((v) => (v._rowId === rowId ? { ...v, encrypted } : v)),
      )
    },
    [commitRows],
  )

  const toggleEnabled = useCallback(
    (rowId: number) => {
      commitRows((prev) =>
        prev.map((v) =>
          v._rowId === rowId ? { ...v, enabled: !v.enabled } : v,
        ),
      )
    },
    [commitRows],
  )

  const removeVar = useCallback(
    (rowId: number) => {
      touchedRowIds.current.delete(rowId)
      commitRows((prev) => {
        const next = prev.filter((v) => v._rowId !== rowId)
        return next.length > 0 ? next : [emptyRow()]
      })
    },
    [commitRows],
  )

  const reorderVars = useCallback(
    (from: number, to: number) => {
      commitRows((prev) => {
        const next = [...prev]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        return next
      })
    },
    [commitRows],
  )

  const handleKeyFocus = useCallback((rowId: number, currentKey: string) => {
    if (!editingKeyRef.current.has(rowId)) {
      editingKeyRef.current.set(rowId, currentKey)
    }
  }, [])

  const handleKeyBlur = useCallback(
    (rowId: number, newKey: string) => {
      const oldKey = editingKeyRef.current.get(rowId)
      editingKeyRef.current.delete(rowId)
      const trimmed = newKey.trim()
      if (!oldKey || !trimmed || oldKey === trimmed) return
      const oldToken = serialize([{ kind: "var", name: oldKey }])
      const newToken = serialize([{ kind: "var", name: trimmed }])
      commitRows((prev) =>
        prev.map((r) => {
          if (r._rowId === rowId || r.encrypted) return r
          const next = r.value.split(oldToken).join(newToken)
          return next !== r.value ? { ...r, value: next } : r
        }),
      )
      onRename(oldKey, trimmed)
    },
    [commitRows, onRename],
  )

  return {
    variables,
    touchedRowIds,
    updateKey,
    updateValue,
    setEncrypted,
    toggleEnabled,
    removeVar,
    reorderVars,
    handleKeyFocus,
    handleKeyBlur,
  }
}
