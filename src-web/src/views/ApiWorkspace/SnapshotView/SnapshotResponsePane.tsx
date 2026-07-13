import { useEffect, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { Segmented } from "@/components/Segmented"
import { Spinner } from "@/components/ui/spinner"
import { useSnapshotsStore } from "@/store/snapshots"
import { FrozenResponse } from "./FrozenResponse"

type ResponseMode = "saved" | "latest" | "diff"

const MODES: readonly { value: ResponseMode; label: string }[] = [
  { value: "saved", label: "Snapshot" },
  { value: "latest", label: "Replay" },
  { value: "diff", label: "Diff" },
]

export function SnapshotResponsePane() {
  const { activeSnapshot, replay, replaying } = useSnapshotsStore(
    useShallow((s) => ({
      activeSnapshot: s.activeSnapshot,
      replay: s.replay,
      replaying: s.replaying,
    })),
  )
  const [mode, setMode] = useState<ResponseMode>("saved")

  const snapshotId = activeSnapshot?.id
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the opened snapshot changes
  useEffect(() => {
    setMode("saved")
  }, [snapshotId])

  const wasReplaying = useRef(false)
  useEffect(() => {
    if (wasReplaying.current && !replaying && replay) setMode("latest")
    wasReplaying.current = replaying
  }, [replaying, replay])

  if (!activeSnapshot) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner className="size-5 text-fg" aria-hidden />
      </div>
    )
  }
  const snapshot = activeSnapshot

  const modeSwitch = replay ? (
    <div className="flex items-center gap-2">
      {replaying && <Spinner className="size-3.5 text-fg" aria-hidden />}
      <Segmented value={mode} options={MODES} onChange={setMode} dense />
    </div>
  ) : null

  const footer = (
    <div className="shrink-0 border-t border-border px-3.5 py-2 flex items-center gap-2">
      <div className="flex-1" />
      <span className="font-mono text-[0.714rem] text-muted whitespace-nowrap shrink-0">
        {snapshot.createdAt.slice(0, 19).replace("T", " ")}
      </span>
      <span className="px-1.5 py-[2px] rounded-[3px] bg-accent/10 text-accent text-[0.643rem] font-mono uppercase tracking-wide whitespace-nowrap shrink-0">
        snapshot
      </span>
    </div>
  )

  return (
    <div className="h-full min-h-0 flex flex-col bg-accent/[0.035]">
      <FrozenResponse
        key={mode}
        trailing={modeSwitch}
        response={
          mode === "latest" && replay ? replay.response : snapshot.response
        }
        diffAgainst={mode === "diff" && replay ? replay.response : null}
      />
      {footer}
    </div>
  )
}
