import { getVersion } from "@tauri-apps/api/app"
import { useEffect, useState } from "react"
import { MonoLabel } from "@/components/Primitives"
import { McpModal } from "@/layout/McpBridge/McpModal"
import { useMcpEnabled } from "@/layout/McpBridge/useMcpEnabled"
import { RecentWorkspaces } from "./RecentWorkspaces"
import { WorkspaceTypeCard } from "./WorkspaceTypeCard"

function McpStatusBadge({ onOpen }: { onOpen: () => void }) {
  const enabled = useMcpEnabled()
  if (enabled === null) return null
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Open MCP Bridge settings"
      className="inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full border border-border bg-surface/60 cursor-pointer outline-none hover:border-accent transition-colors"
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{
          background: enabled ? "var(--base0B)" : "var(--base04)",
        }}
      />
      <span className="font-mono text-[0.679rem] uppercase tracking-[0.2em] text-muted">
        MCP {enabled ? "ready" : "idle"}
      </span>
    </button>
  )
}

type Mode = "api" | "import"

interface HomeViewProps {
  onSelect: (mode: Mode) => void
}

export function HomeView({ onSelect }: HomeViewProps) {
  const [showMcp, setShowMcp] = useState(false)
  const [appVersion, setAppVersion] = useState("")

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {})
  }, [])

  return (
    <div className="relative flex-1 flex flex-col items-center [justify-content:safe_center] overflow-auto py-16 px-6">
      <div className="w-full max-w-[680px] flex flex-col gap-8">
        <div>
          <div
            className="text-[2.714rem] text-fg leading-none"
            style={{ fontFamily: '"Goldman", sans-serif' }}
          >
            voleeo
          </div>
          <div
            className="h-px mt-1"
            style={{
              width: "30%",
              background:
                "linear-gradient(to right, var(--base0D), transparent)",
            }}
          />
          <MonoLabel size={10} style={{ marginTop: 8 }}>
            Builds side by side with you
          </MonoLabel>
        </div>

        <div className="flex gap-3">
          <WorkspaceTypeCard
            icon="api"
            title="New Workspace"
            description="HTTP / WebSockets / gRPC / GraphQL"
            onClick={() => onSelect("api")}
          />
          <WorkspaceTypeCard
            icon="import"
            title="Open or Import"
            description="Folder / Git"
            onClick={() => onSelect("import")}
          />
        </div>

        <RecentWorkspaces />
      </div>

      <div className="absolute bottom-4 left-0 right-0 flex flex-col items-center gap-2">
        <McpStatusBadge onOpen={() => setShowMcp(true)} />
        <span className="pointer-events-none">
          <MonoLabel size={10}>{appVersion}</MonoLabel>
        </span>
      </div>
      {showMcp && <McpModal onClose={() => setShowMcp(false)} />}
    </div>
  )
}
