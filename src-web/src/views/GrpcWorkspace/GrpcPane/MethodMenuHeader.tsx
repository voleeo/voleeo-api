import { open } from "@tauri-apps/plugin-dialog"
import { Glyph } from "@/components/Glyph"
import { cn } from "@/lib/utils"
import type { ProtoSource } from "../../../../../packages/types/bindings"

const SRC_BTN =
  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-[5px] border border-border text-muted hover:text-fg hover:border-accent outline-none shrink-0 transition-colors font-mono text-[0.786rem]"

export function MethodMenuHeader({
  protoSource,
  onProtoSourceChange,
  refreshing,
  onRefresh,
  filter,
  onFilter,
}: {
  protoSource: ProtoSource
  onProtoSourceChange: (next: ProtoSource) => void
  refreshing: boolean
  onRefresh: () => void
  filter: string
  onFilter: (next: string) => void
}) {
  const isFiles = protoSource.kind === "files"
  const hasFiles = protoSource.kind === "files" && protoSource.paths.length > 0

  async function pickFiles() {
    const picked = await open({
      multiple: true,
      filters: [{ name: "Protocol Buffers", extensions: ["proto"] }],
    })
    if (!picked) return
    const paths = Array.isArray(picked) ? picked : [picked]
    onProtoSourceChange({ kind: "files", paths, include_dirs: [] })
  }

  const searchBox = (
    <div className="flex items-center gap-1.5 flex-1 min-w-0 px-2 py-1.5 rounded-[5px] bg-bg border border-border">
      <Glyph kind="search" size={13} color="var(--base04)" />
      <input
        autoFocus
        value={filter}
        onChange={(e) => onFilter(e.target.value)}
        placeholder="Filter services & methods…"
        className="flex-1 min-w-0 bg-transparent outline-none font-mono text-[0.857rem] text-fg placeholder:text-muted"
      />
    </div>
  )

  return (
    <div className="flex items-center gap-2 p-2 border-b border-border shrink-0">
      {!isFiles ? (
        searchBox
      ) : hasFiles ? (
        <>
          <div className="flex items-center gap-1.5 shrink-0 px-2 py-1.5 rounded-[5px] bg-bg border border-border">
            <button
              type="button"
              onClick={pickFiles}
              title={`${protoSource.paths.length} .proto file${protoSource.paths.length === 1 ? "" : "s"} — click to change`}
              aria-label="Change .proto files"
              className="inline-flex text-fg hover:text-accent outline-none transition-colors"
            >
              <Glyph kind="file" size={14} color="currentColor" />
            </button>
            <button
              type="button"
              onClick={() =>
                onProtoSourceChange({
                  kind: "files",
                  paths: [],
                  include_dirs: [],
                })
              }
              title="Clear files"
              aria-label="Clear files"
              className="inline-flex text-muted hover:text-fg outline-none transition-colors"
            >
              <Glyph kind="x" size={12} color="currentColor" />
            </button>
          </div>
          {searchBox}
        </>
      ) : (
        <button
          type="button"
          onClick={pickFiles}
          className="flex items-center gap-1.5 flex-1 min-w-0 px-2 py-1.5 rounded-[5px] bg-bg border border-border text-left outline-none hover:border-accent transition-colors"
        >
          <Glyph kind="file" size={13} color="var(--base04)" />
          <span className="font-mono text-[0.857rem] text-fg truncate flex-1">
            Choose .proto file…
          </span>
        </button>
      )}
      {isFiles ? (
        <button
          type="button"
          onClick={() => onProtoSourceChange({ kind: "reflection" })}
          title="Switch to server reflection"
          className={SRC_BTN}
        >
          <Glyph kind="file" size={13} color="currentColor" />
          Proto File
        </button>
      ) : (
        <button
          type="button"
          onClick={() =>
            onProtoSourceChange({
              kind: "files",
              paths: [],
              include_dirs: [],
            })
          }
          title="Switch to .proto files"
          className={SRC_BTN}
        >
          <Glyph kind="lightning" size={13} color="currentColor" />
          Reflection
        </button>
      )}
      {!isFiles && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          title="Refresh schema"
          aria-label="Refresh schema"
          className="flex items-center justify-center p-1.5 rounded-[5px] border border-border text-muted hover:text-fg hover:border-accent disabled:opacity-50 outline-none shrink-0 transition-colors"
        >
          <span className={cn("inline-flex", refreshing && "animate-spin")}>
            <Glyph kind="arrows-clockwise" size={14} color="currentColor" />
          </span>
        </button>
      )}
    </div>
  )
}
