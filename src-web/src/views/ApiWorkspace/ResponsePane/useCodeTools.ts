import { useCallback, useState } from "react"

export interface CodeTools {
  findOpen: boolean
  filterOpen: boolean
  openFind: () => void
  closeFind: () => void
  openFilter: () => void
  closeFilter: () => void
}

export function useCodeTools(): CodeTools {
  const [findOpen, setFindOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)

  const openFind = useCallback(() => {
    setFilterOpen(false)
    setFindOpen(true)
  }, [])
  const closeFind = useCallback(() => setFindOpen(false), [])
  const openFilter = useCallback(() => {
    setFindOpen(false)
    setFilterOpen(true)
  }, [])
  const closeFilter = useCallback(() => setFilterOpen(false), [])

  return { findOpen, filterOpen, openFind, closeFind, openFilter, closeFilter }
}
