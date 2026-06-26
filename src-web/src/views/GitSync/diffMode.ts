import { useEffect, useState } from "react"

export type ViewMode = "summary" | "diff"

export const VIEW_MODES = [
  { value: "summary", label: "Summary" },
  { value: "diff", label: "Diff" },
] as const satisfies readonly { value: ViewMode; label: string }[]

export function useEntityPatch(
  mode: ViewMode,
  path: string | undefined,
  fetcher: (path: string) => Promise<string>,
): string | null {
  const [patch, setPatch] = useState<string | null>(null)
  useEffect(() => {
    if (mode !== "diff" || !path) return
    let alive = true
    setPatch(null)
    void fetcher(path).then((p) => {
      if (alive) setPatch(p)
    })
    return () => {
      alive = false
    }
  }, [mode, path, fetcher])
  return patch
}
