import { useEffect, useState } from "react"
import { Switch } from "@/components/ui/switch"
import { commands } from "../../../../packages/types/bindings"

export function CustomTitleBarRow() {
  const [enabled, setEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    commands.settingsGetCustomTitleBar().then((res) => {
      if (!cancelled && res.status === "ok") setEnabled(res.data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = (next: boolean) => {
    setEnabled(next)
    commands.settingsSetCustomTitleBar(next)
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <label className="block text-[0.929rem] text-fg font-semibold">
          Unified title bar
        </label>
        <p className="text-[0.857rem] text-muted mt-0.5">
          Merge window controls into the toolbar. Restarts the app.
        </p>
      </div>
      <Switch
        checked={enabled ?? false}
        onCheckedChange={toggle}
        disabled={enabled === null}
        size="sm"
      />
    </div>
  )
}
