import { listen } from "@tauri-apps/api/event"
import { useEffect, useState } from "react"
import { commands } from "../../../../packages/types/bindings"

// MCP enabled state, kept live via the `mcp:enabled:changed` backend event.
export function useMcpEnabled() {
  const [enabled, setEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    commands.settingsGetMcp().then((res) => {
      if (!cancelled && res.status === "ok") setEnabled(res.data.enabled)
    })
    const unlisten = listen<{ enabled: boolean }>(
      "mcp:enabled:changed",
      ({ payload }) => setEnabled(payload.enabled),
    )
    return () => {
      cancelled = true
      unlisten.then((f) => f())
    }
  }, [])

  return enabled
}
