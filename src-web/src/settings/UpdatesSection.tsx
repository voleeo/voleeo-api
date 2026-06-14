import { useShallow } from "zustand/react/shallow"
import { cn } from "@/lib/utils"
import { useUpdateStore } from "@/store/update"

function statusText(
  status: ReturnType<typeof useUpdateStore.getState>["status"],
  version: string | null,
  progress: number,
  error: string | null,
): string {
  switch (status) {
    case "checking":
      return "Checking for updates…"
    case "downloading":
      return `Downloading ${version} — ${Math.round(progress * 100)}%`
    case "ready":
      return `Update ${version} is ready to install`
    case "upToDate":
      return "You're up to date"
    case "error":
      return error ?? "Update check failed"
    default:
      return ""
  }
}

export function UpdatesSection() {
  const { status, version, progress, error, check, installAndRelaunch } =
    useUpdateStore(
      useShallow((s) => ({
        status: s.status,
        version: s.version,
        progress: s.progress,
        error: s.error,
        check: s.check,
        installAndRelaunch: s.installAndRelaunch,
      })),
    )

  const busy = status === "checking" || status === "downloading"
  const text = statusText(status, version, progress, error)

  return (
    <div className="mt-8">
      <h2 className="text-[1.286rem] font-semibold mb-5 text-fg">Updates</h2>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void check({ silent: false })}
          className="px-3 py-[6px] rounded-md text-sm bg-subtle text-fg hover:bg-border disabled:opacity-50 disabled:cursor-default transition-colors cursor-pointer border-none outline-none"
        >
          Check for Updates
        </button>
        {status === "ready" && (
          <button
            type="button"
            onClick={() => void installAndRelaunch()}
            className="px-3 py-[6px] rounded-md text-sm bg-accent/15 text-accent hover:bg-accent/25 transition-colors cursor-pointer border-none outline-none"
          >
            Install &amp; Restart
          </button>
        )}
        {text && (
          <span
            className={cn(
              "text-sm",
              status === "error" ? "text-error" : "text-muted",
            )}
          >
            {text}
          </span>
        )}
      </div>
    </div>
  )
}
