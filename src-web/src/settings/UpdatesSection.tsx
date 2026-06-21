import { useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type { UpdateStatus } from "@/store/update"
import { getAutoUpdate, setAutoUpdate, useUpdateStore } from "@/store/update"

function statusCopy(
  status: UpdateStatus,
  version: string | null,
  current: string,
  progress: number,
  error: string | null,
): { title: string; body: string } {
  switch (status) {
    case "checking":
      return {
        title: "Checking for updates…",
        body: "Looking for a newer version…",
      }
    case "downloading":
      return {
        title: "Downloading update",
        body: `${Math.round(progress * 100)}% downloaded…`,
      }
    case "ready":
      return {
        title: "Update available",
        body: `Version ${version} is ready to install. You're on ${current}.`,
      }
    case "upToDate":
      return {
        title: "You're up to date",
        body: `Voleeo ${current} is the latest version.`,
      }
    case "error":
      return {
        title: "Couldn't check for updates",
        body: error ?? "Update check failed.",
      }
    default:
      return { title: "Check for updates", body: `You're on ${current}.` }
  }
}

export function UpdatesSection({ currentVersion }: { currentVersion: string }) {
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
  const [auto, setAuto] = useState(true)
  useEffect(() => {
    getAutoUpdate().then(setAuto)
  }, [])

  const busy = status === "checking" || status === "downloading"
  const isUpdate = status === "ready"
  const { title, body } = statusCopy(
    status,
    version,
    currentVersion,
    progress,
    error,
  )

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[0.929rem] font-semibold text-fg">Updates</h2>

      <div
        className={cn(
          "border rounded-[8px] px-4 py-3.5 flex items-center gap-4",
          isUpdate ? "border-accent/40 bg-accent/5" : "border-border bg-bg",
        )}
      >
        <div className="min-w-0 flex-1 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-sans text-[0.929rem] font-semibold text-fg">
              {title}
            </span>
            {(isUpdate || status === "downloading") && version && (
              <span className="font-mono text-[0.714rem] text-accent bg-accent/15 rounded-full px-2 py-0.5">
                {version}
              </span>
            )}
          </div>
          <p
            className={cn(
              "font-sans text-[0.786rem] leading-relaxed",
              status === "error" ? "text-error" : "text-muted",
            )}
          >
            {body}
          </p>
          {status === "downloading" && (
            <div className="mt-1 h-1 rounded-full bg-subtle overflow-hidden">
              <div
                className="h-full bg-accent transition-[width]"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          )}
        </div>

        {isUpdate ? (
          <Button
            size="sm"
            onClick={() => void installAndRelaunch()}
            className="cursor-pointer shrink-0"
          >
            Install now
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void check({ silent: false })}
            className="cursor-pointer shrink-0 gap-1.5 border-border text-fg hover:bg-subtle"
          >
            {busy && <Spinner className="size-3.5 shrink-0" />}
            {status === "error" ? "Try again" : "Check now"}
          </Button>
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="font-sans text-[0.929rem] font-medium text-fg">
            Automatic updates
          </div>
          <p className="font-sans text-[0.786rem] text-muted leading-relaxed mt-0.5">
            {auto
              ? "Check for new versions in the background and keep Voleeo current."
              : "Voleeo only checks when you click Check now."}
          </p>
        </div>
        <Switch
          checked={auto}
          onCheckedChange={(c) => {
            setAuto(c)
            void setAutoUpdate(c)
          }}
        />
      </div>
    </section>
  )
}
