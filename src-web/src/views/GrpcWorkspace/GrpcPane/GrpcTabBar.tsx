import type { ReactNode } from "react"
import { TabItem } from "@/components/Primitives"
import { cn } from "@/lib/utils"
import { AuthTypeSelect } from "@/views/ApiWorkspace/AuthTab/AuthTypeSelect"
import type { AuthConfig } from "../../../../../packages/types/bindings"

export type GrpcTab = "message" | "metadata" | "auth"
export const GRPC_TABS: GrpcTab[] = ["message", "metadata", "auth"]

export type MsgMode = "form" | "editor"

export function GrpcTabBar({
  tab,
  onTab,
  labels,
  hasSchema,
  msgMode,
  onMsgMode,
  auth,
  onAuthChange,
}: {
  tab: GrpcTab
  onTab: (next: GrpcTab) => void
  labels: Record<GrpcTab, ReactNode>
  hasSchema: boolean
  msgMode: MsgMode
  onMsgMode: (next: MsgMode) => void
  auth: AuthConfig
  onAuthChange: (next: AuthConfig) => void
}) {
  return (
    <div className="px-3.5 border-b border-border flex shrink-0">
      {GRPC_TABS.map((t) => (
        <TabItem
          key={t}
          label={labels[t]}
          active={tab === t}
          onClick={() => onTab(t)}
        />
      ))}
      {tab === "message" && hasSchema && (
        <div className="ml-auto flex items-center">
          <MsgModeToggle value={msgMode} onChange={onMsgMode} />
        </div>
      )}
      {tab === "auth" && (
        <div className="ml-auto flex items-center">
          <AuthTypeSelect auth={auth} onChange={onAuthChange} allowInherit />
        </div>
      )}
    </div>
  )
}

/** Form (generated fields) vs Editor (raw protobuf-JSON) for the message tab. */
function MsgModeToggle({
  value,
  onChange,
}: {
  value: MsgMode
  onChange: (next: MsgMode) => void
}) {
  const options: { value: MsgMode; label: string }[] = [
    { value: "form", label: "Form" },
    { value: "editor", label: "Editor" },
  ]
  return (
    <div className="flex items-center gap-0.5 rounded-[6px] p-[2px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "flex items-center px-2.5 py-0.5 rounded-[4px] border-0 outline-none cursor-pointer font-sans text-[0.857rem] transition-colors",
            o.value === value
              ? "bg-accent/15 text-accent"
              : "bg-transparent text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
