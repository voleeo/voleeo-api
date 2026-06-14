import { useShallow } from "zustand/react/shallow"
import { Glyph } from "@/components/Glyph"
import { useUpdateStore } from "@/store/update"

export function UpdateBanner() {
  const { status, version, progress, installAndRelaunch, dismiss } =
    useUpdateStore(
      useShallow((s) => ({
        status: s.status,
        version: s.version,
        progress: s.progress,
        installAndRelaunch: s.installAndRelaunch,
        dismiss: s.dismiss,
      })),
    )

  if (status !== "downloading" && status !== "ready") return null

  const downloading = status === "downloading"

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[310] flex items-center gap-3 px-4 py-2.5 rounded-[6px] border border-accent/40 bg-surface text-fg shadow-[0_8px_24px_rgba(0,0,0,0.5)] font-sans text-[0.929rem]">
      <Glyph kind="import" color="var(--base0D)" />
      {downloading ? (
        <span className="text-muted">
          Downloading Voleeo {version}… {Math.round(progress * 100)}%
        </span>
      ) : (
        <>
          <span>
            Voleeo <span className="text-accent font-medium">{version}</span> is
            ready to install
          </span>
          <button
            type="button"
            onClick={() => void installAndRelaunch()}
            className="px-2.5 py-1 rounded-[5px] bg-accent/15 text-accent hover:bg-accent/25 transition-colors cursor-pointer border-none outline-none"
          >
            Install &amp; Restart
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="grid place-items-center size-6 rounded-[5px] text-muted hover:text-fg hover:bg-subtle transition-colors cursor-pointer border-none outline-none bg-transparent"
          >
            <Glyph kind="x" />
          </button>
        </>
      )}
    </div>
  )
}
