import type { ReactNode } from "react"
import { useEffect } from "react"
import { useShallow } from "zustand/react/shallow"
import { UpdatesSection } from "@/settings/UpdatesSection"
import { useAppStore } from "@/store/app"

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-4 px-4 py-3">
      <span className="w-32 shrink-0 font-sans text-[0.857rem] text-muted">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export function GeneralPanel() {
  const { info, fetchInfo } = useAppStore(
    useShallow((s) => ({ info: s.info, fetchInfo: s.fetchInfo })),
  )

  useEffect(() => {
    fetchInfo()
  }, [fetchInfo])

  if (!info) return null

  return (
    <div className="w-full flex flex-col gap-8">
      <div>
        <h1 className="text-[1.286rem] font-semibold text-fg">General</h1>
        <p className="font-sans text-[0.857rem] text-muted mt-1">
          App information and how Voleeo keeps itself updated.
        </p>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-[0.929rem] font-semibold text-fg">App info</h2>
        <div className="border border-border rounded-[8px] bg-bg divide-y divide-border">
          <InfoRow label="Version">
            <span className="inline-block font-mono text-[0.786rem] text-fg bg-subtle rounded-[4px] px-2 py-0.5">
              {info.version}
            </span>
          </InfoRow>
          <InfoRow label="Data directory">
            <span className="font-mono text-[0.75rem] text-fg break-all">
              {info.data_dir}
            </span>
          </InfoRow>
          <InfoRow label="Log directory">
            <span className="font-mono text-[0.75rem] text-fg break-all">
              {info.log_dir}
            </span>
          </InfoRow>
        </div>
      </section>

      <UpdatesSection currentVersion={info.version} />
    </div>
  )
}
