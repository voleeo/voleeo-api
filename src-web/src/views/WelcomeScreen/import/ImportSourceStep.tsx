import { getCurrentWebview } from "@tauri-apps/api/webview"
import { open } from "@tauri-apps/plugin-dialog"
import { useEffect, useRef, useState } from "react"
import { Glyph } from "@/components/Glyph"
import { Spinner } from "@/components/ui/spinner"
import { errorMessage } from "@/lib/error"
import { cn } from "@/lib/utils"
import { commands } from "../../../../../packages/types/bindings"
import { FlowBtn } from "../FlowBtn"

const ACCEPTED = ["json", "yaml", "yml"]
const URL_INPUT =
  "w-full bg-bg border border-border rounded-[6px] pl-8 pr-2.5 py-2 text-[0.857rem] text-fg font-mono outline-none focus:border-accent"

interface ImportSourceStepProps {
  onLoaded: (content: string, label: string) => void
  onError: (msg: string) => void
}

export function ImportSourceStep({ onLoaded, onError }: ImportSourceStepProps) {
  const [url, setUrl] = useState("")
  const [fileLoading, setFileLoading] = useState(false)
  const [urlLoading, setUrlLoading] = useState(false)
  const [dragging, setDragging] = useState(false)

  async function readPath(path: string) {
    onError("")
    setFileLoading(true)
    try {
      const res = await commands.importReadFile(path)
      if (res.status === "ok") onLoaded(res.data, basename(path))
      else onError(errorMessage(res.error))
    } finally {
      setFileLoading(false)
    }
  }

  // Latest drop handler, read by the mount-once listener below — keeps the
  // Tauri subscription stable while always calling fresh callbacks.
  const onDropRef = useRef<(paths: string[]) => void>(() => {})
  onDropRef.current = (paths) => {
    const path = paths.find((f) =>
      ACCEPTED.includes(f.split(".").pop()?.toLowerCase() ?? ""),
    )
    if (path) readPath(path)
    else if (paths.length > 0)
      onError("Unsupported file — pick a .json, .yaml, or .yml file.")
  }

  // Tauri intercepts OS file drops window-wide; accept any spec-typed file.
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload
      if (p.type === "enter" || p.type === "over") setDragging(true)
      else if (p.type === "leave") setDragging(false)
      else if (p.type === "drop") {
        setDragging(false)
        onDropRef.current(p.paths)
      }
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  async function handlePickFile() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Collections", extensions: ACCEPTED }],
    })
    if (!selected) return
    await readPath(typeof selected === "string" ? selected : selected[0])
  }

  async function handleFetchUrl() {
    const trimmed = url.trim()
    if (!trimmed) return
    onError("")
    setUrlLoading(true)
    try {
      const res = await commands.importFetchUrl(trimmed)
      if (res.status === "ok") onLoaded(res.data, hostLabel(trimmed))
      else onError(errorMessage(res.error))
    } finally {
      setUrlLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <button
        type="button"
        onClick={handlePickFile}
        disabled={fileLoading}
        className={cn(
          "flex flex-col items-center justify-center gap-2 w-full min-h-[200px] rounded-[10px] border border-dashed transition-colors cursor-pointer outline-none",
          dragging
            ? "border-accent bg-accent/10"
            : "border-border bg-subtle/30 hover:border-accent/60 hover:bg-subtle/50",
        )}
      >
        {fileLoading ? (
          <Spinner className="size-5" />
        ) : (
          <Glyph kind="upload-simple" size={26} color="var(--base0D)" />
        )}
        <span className="font-sans text-[1rem] font-semibold text-fg">
          {dragging ? "Drop to import" : "Choose a file or drag it here"}
        </span>
        <span className="text-[0.786rem] text-muted">
          .json, .yaml, or .yml · up to 10 MB
        </span>
      </button>

      <div className="flex items-center gap-3 text-[0.714rem] text-muted">
        <div className="h-px flex-1 bg-border" />
        or fetch from a URL
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
            <Glyph kind="link" size={13} color="var(--base04)" />
          </span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleFetchUrl()
            }}
            placeholder="https://api.example.com/openapi.json"
            className={URL_INPUT}
          />
        </div>
        <FlowBtn onClick={handleFetchUrl} disabled={urlLoading || !url.trim()}>
          {urlLoading ? <Spinner className="size-3 shrink-0" /> : "Fetch"}
        </FlowBtn>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FormatChip label="OpenAPI 3.0 / 3.1" active />
        <FormatChip label="Swagger 2.0" active />
        <FormatChip label="Postman" active />
        <FormatChip label="Insomnia" active />
      </div>
      <p className="text-[0.714rem] text-muted leading-relaxed">
        Import from OpenAPI, Swagger 2.0, Postman, or Insomnia.
      </p>
    </div>
  )
}

function FormatChip({
  label,
  active,
  soon,
}: {
  label: string
  active?: boolean
  soon?: boolean
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[0.714rem] font-medium",
        active
          ? "border-[var(--base0B)]/50 text-[var(--base0B)] bg-[var(--base0B)]/10"
          : "border-border text-muted",
      )}
    >
      {active && <Glyph kind="check" size={11} color="var(--base0B)" />}
      {label}
      {soon && <span className="text-muted/70">· soon</span>}
    </span>
  )
}

function basename(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

function hostLabel(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}
