import { useEffect, useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import { Glyph } from "@/components/Glyph"
import { useFolderRunStore } from "@/store/folderRun"
import { selectActiveFolder, useRequestStore } from "@/store/requests"
import { FolderRunList } from "./FolderRunList"
import { FolderRunStrategyToggle } from "./FolderRunStrategyToggle"
import { useFolderRun } from "./useFolderRun"
import {
  collectDescendantRequests,
  type FolderPathSegment,
  folderPathsUnder,
  useStoredSendCtx,
} from "./useStoredSend"

export function FolderRunPanel() {
  const folder = useRequestStore(selectActiveFolder)
  const { folders, requests } = useRequestStore(
    useShallow((s) => ({ folders: s.folders, requests: s.requests })),
  )

  const folderId = folder?.id ?? null
  const ordered = useMemo(
    () =>
      folderId ? collectDescendantRequests(folderId, folders, requests) : [],
    [folderId, folders, requests],
  )
  const folderPaths = useMemo(
    () =>
      folderId
        ? folderPathsUnder(folderId, folders)
        : new Map<string, FolderPathSegment[]>(),
    [folderId, folders],
  )

  const { strategy, status, initFor, setStrategy } = useFolderRunStore(
    useShallow((s) => ({
      strategy: s.strategy,
      status: s.status,
      initFor: s.initFor,
      setStrategy: s.setStrategy,
    })),
  )
  const includedCount = useFolderRunStore(
    (s) => Object.values(s.included).filter(Boolean).length,
  )

  const ids = useMemo(() => ordered.map((r) => r.id), [ordered])
  useEffect(() => {
    if (folderId) initFor(folderId, ids)
  }, [folderId, ids, initFor])

  const ctx = useStoredSendCtx()
  useFolderRun(ordered, ctx)

  const isRunning = status === "running"

  return (
    <div className="h-full flex flex-col bg-bg">
      {ordered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-6 text-center">
          <p className="font-sans text-[0.929rem] text-muted">
            This folder has no requests to run.
          </p>
        </div>
      ) : (
        <>
          <div className="px-3.5 min-h-[40px] border-b border-border flex items-center gap-3 shrink-0">
            <span className="font-sans text-[0.714rem] uppercase tracking-[1.4px] text-muted/70 font-semibold">
              Run
            </span>
            <FolderRunStrategyToggle
              value={strategy}
              disabled={isRunning}
              onChange={setStrategy}
            />
            <div className="flex-1" />
            <button
              type="button"
              disabled={!isRunning && includedCount === 0}
              onClick={() =>
                isRunning
                  ? useFolderRunStore.getState().requestCancel()
                  : useFolderRunStore.getState().requestStart()
              }
              className="p-2 flex items-center justify-center cursor-pointer bg-transparent hover:bg-subtle rounded-[5px] disabled:cursor-not-allowed disabled:opacity-40 outline-none shrink-0 transition-colors"
              title={isRunning ? "Cancel run" : "Run folder"}
              aria-label={isRunning ? "Cancel run" : "Run folder"}
            >
              {isRunning ? (
                <Glyph kind="x" size={14} color="var(--base08)" />
              ) : (
                <Glyph kind="send-right" size={14} color="var(--base0D)" />
              )}
            </button>
          </div>
          <FolderRunList ordered={ordered} folderPaths={folderPaths} />
        </>
      )}
    </div>
  )
}
