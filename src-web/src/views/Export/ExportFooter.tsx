import { getCurrentWindow } from "@tauri-apps/api/window"
import { Glyph } from "@/components/Glyph"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Meta } from "./parts"

const DOT = <span className="text-[var(--base03)]">·</span>

export function ExportFooter({
  workspaceCount,
  totReq,
  totEnv,
  noteCount,
  canExport,
  exporting,
  label,
  onExport,
}: {
  workspaceCount: number
  totReq: number
  totEnv: number
  noteCount: number
  canExport: boolean
  exporting: boolean
  label: string
  onExport: () => void
}) {
  return (
    <footer className="flex shrink-0 items-center gap-4 border-t border-border px-6 py-3.5">
      <div className="flex min-w-0 items-center gap-3.5">
        <Meta icon={<Glyph kind="folder" size={14} color="currentColor" />}>
          {workspaceCount} workspace{workspaceCount === 1 ? "" : "s"}
        </Meta>
        {DOT}
        <Meta
          icon={
            <Glyph kind="arrows-left-right" size={14} color="currentColor" />
          }
        >
          {totReq} requests
        </Meta>
        {DOT}
        <Meta icon={<Glyph kind="stack" size={14} color="currentColor" />}>
          {totEnv} env{totEnv === 1 ? "" : "s"}
        </Meta>
        {noteCount > 0 && (
          <>
            {DOT}
            <Meta
              icon={<Glyph kind="info" size={14} color="currentColor" />}
              tone="text-warn"
            >
              {noteCount} note{noteCount === 1 ? "" : "s"}
            </Meta>
          </>
        )}
      </div>
      <span className="flex-1" />
      <Button
        variant="outline"
        size="lg"
        className="cursor-pointer"
        onClick={() => getCurrentWindow().close()}
      >
        Cancel
      </Button>
      <Button
        variant="default"
        size="lg"
        className="cursor-pointer"
        disabled={!canExport || exporting}
        onClick={onExport}
      >
        {exporting ? (
          <Spinner className="size-3.5 shrink-0" />
        ) : (
          <Glyph kind="download-simple" size={14} color="currentColor" />
        )}
        {exporting ? "Exporting" : label}
      </Button>
    </footer>
  )
}
