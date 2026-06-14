import { useEffect } from "react"
import { useShallow } from "zustand/react/shallow"
import { UpdatesSection } from "@/settings/UpdatesSection"
import { useAppStore } from "@/store/app"

export function GeneralPanel() {
  const { info, fetchInfo } = useAppStore(
    useShallow((s) => ({ info: s.info, fetchInfo: s.fetchInfo })),
  )

  useEffect(() => {
    fetchInfo()
  }, [fetchInfo])

  if (!info) return null

  return (
    <section>
      <h2 className="text-[1.286rem] font-semibold mb-5 text-fg">App Info</h2>
      <dl
        className="grid gap-y-3 gap-x-4 text-sm"
        style={{ gridTemplateColumns: "140px 1fr" }}
      >
        <dt className="text-muted self-start pt-[1px]">Version</dt>
        <dd className="m-0 text-fg">{info.version}</dd>
        <dt className="text-muted self-start pt-[1px]">Data directory</dt>
        <dd className="m-0 text-fg font-mono text-xs break-all">
          {info.data_dir}
        </dd>
        <dt className="text-muted self-start pt-[1px]">Log directory</dt>
        <dd className="m-0 text-fg font-mono text-xs break-all">
          {info.log_dir}
        </dd>
      </dl>
      <UpdatesSection />
    </section>
  )
}
