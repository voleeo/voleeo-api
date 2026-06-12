import { useCallback, useEffect, useRef, useState } from "react"
import { randomId } from "@/lib/ids"
import type { BodyField } from "@/store/requests"

function emptyField(): BodyField {
  return { id: randomId(), name: "", value: "", enabled: true, isFile: false }
}

const isEmpty = (f: BodyField) => f.name.trim() === "" && f.value.trim() === ""

/** Always keep exactly one trailing empty row so a new field spawns the moment
 *  the last one gets content — the same flow as the query-params editor. */
function ensureTrailing(rows: BodyField[]): BodyField[] {
  const last = rows[rows.length - 1]
  return !last || !isEmpty(last) ? [...rows, emptyField()] : rows
}

export interface UseFieldRowsResult {
  rows: BodyField[]
  isTrailing: (row: BodyField, index: number) => boolean
  patch: (id: string, next: Partial<BodyField>) => void
  remove: (id: string) => void
}

/** Trailing-row editor state for form-urlencoded / multipart bodies. Persists
 *  only non-empty rows via `onChange`; mirrors `useQueryRows`. */
export function useFieldRows(
  fields: BodyField[],
  onChange: (fields: BodyField[]) => void,
): UseFieldRowsResult {
  const [rows, setRows] = useState<BodyField[]>(() =>
    ensureTrailing([...fields]),
  )
  // Suppress self-echo: holds the JSON we last emitted so the sync effect only
  // resets rows on a genuinely external change (request switch, import).
  const prevJson = useRef(JSON.stringify(fields))

  useEffect(() => {
    const key = JSON.stringify(fields)
    if (key === prevJson.current) return
    prevJson.current = key
    setRows(ensureTrailing([...fields]))
  }, [fields])

  const commit = useCallback(
    (next: BodyField[]) => {
      const withTrailing = ensureTrailing(next)
      const persisted = withTrailing.filter((r) => !isEmpty(r))
      prevJson.current = JSON.stringify(persisted)
      setRows(withTrailing)
      onChange(persisted)
    },
    [onChange],
  )

  const patch = useCallback(
    (id: string, next: Partial<BodyField>) => {
      commit(rows.map((r) => (r.id === id ? { ...r, ...next } : r)))
    },
    [rows, commit],
  )

  const remove = useCallback(
    (id: string) => {
      commit(rows.filter((r) => r.id !== id))
    },
    [rows, commit],
  )

  const isTrailing = useCallback(
    (row: BodyField, index: number) =>
      index === rows.length - 1 && isEmpty(row),
    [rows],
  )

  return { rows, isTrailing, patch, remove }
}
