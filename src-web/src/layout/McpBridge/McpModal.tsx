import { useCallback, useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Glyph } from "@/components/Glyph"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type { McpSettings } from "../../../../packages/types/bindings"
import { commands } from "../../../../packages/types/bindings"
import { McpClientPanel } from "./McpClientPanel"
import { MCP_CLIENTS } from "./McpClients"

interface Props {
  onClose: () => void
}

export function McpModal({ onClose }: Props) {
  const [settings, setSettings] = useState<McpSettings | null>(null)
  const [bridgePath, setBridgePath] = useState("voleeo-mcp-bridge")
  const [selectedId, setSelectedId] = useState(MCP_CLIENTS[0].id)
  const [regenerating, setRegenerating] = useState(false)

  const load = useCallback(async () => {
    const [sr, ir] = await Promise.all([
      commands.settingsGetMcp(),
      commands.getAppInfo(),
    ])
    if (sr.status === "ok") setSettings(sr.data)
    if (ir.status === "ok") setBridgePath(ir.data.bridge_path)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const toggleEnabled = useCallback(async () => {
    if (!settings) return
    const res = await commands.settingsSetMcpEnabled(!settings.enabled)
    if (res.status === "ok") setSettings(res.data)
  }, [settings])

  const regenerateToken = useCallback(async () => {
    setRegenerating(true)
    const res = await commands.settingsRegenerateMcpToken()
    if (res.status === "ok")
      setSettings((s) => (s ? { ...s, token: res.data } : s))
    setRegenerating(false)
  }, [])

  const selectedClient =
    MCP_CLIENTS.find((c) => c.id === selectedId) ?? MCP_CLIENTS[0]

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/50 border-0 cursor-default"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      />
      <div className="relative z-10 flex flex-col w-[780px] max-h-[85vh] bg-bg border border-border rounded-[10px] shadow-[0_8px_40px_rgba(0,0,0,0.6)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border shrink-0">
          <Glyph kind="bridge" size={15} color="var(--base04)" />
          <div className="flex-1">
            <div className="font-sans text-[0.929rem] font-medium text-fg leading-tight">
              MCP Bridge
            </div>
            <div className="font-sans text-[0.786rem] font-normal text-muted">
              Connect AI clients to your workspaces
            </div>
          </div>
          <div className="flex items-center gap-2 mr-3">
            <span className="text-[0.786rem] text-muted">
              {settings?.enabled ? "Enabled" : "Disabled"}
            </span>
            <Switch
              checked={settings?.enabled ?? false}
              onCheckedChange={toggleEnabled}
              disabled={!settings}
              size="sm"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-fg cursor-pointer border-none bg-transparent p-0.5 transition-colors"
          >
            <Glyph kind="x" size={14} color="currentColor" />
          </button>
        </div>

        {/* Body */}
        <div className="flex min-w-0 overflow-hidden">
          {/* Sidebar */}
          <div className="w-[188px] border-r border-border flex flex-col py-3 shrink-0">
            <div className="px-3 pb-2 text-[0.714rem] font-semibold text-muted tracking-widest uppercase">
              Clients
            </div>
            {MCP_CLIENTS.map((client) => {
              const active = client.id === selectedId
              return (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => setSelectedId(client.id)}
                  className={cn(
                    "text-left w-full px-3 py-2 text-[0.929rem] font-normal cursor-pointer border-none transition-colors",
                    active
                      ? "bg-subtle text-fg"
                      : "bg-transparent text-muted hover:bg-subtle hover:text-fg",
                  )}
                >
                  {client.name}
                </button>
              )
            })}
          </div>

          {/* Right panel */}
          <McpClientPanel
            client={selectedClient}
            token={settings?.token ?? ""}
            bridgePath={bridgePath}
            regenerating={regenerating}
            onRegenerateToken={regenerateToken}
          />
        </div>
      </div>
    </div>,
    document.body,
  )
}
