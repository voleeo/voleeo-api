import { useMemo, useState } from "react"
import { Glyph } from "@/components/Glyph"
import { cn } from "@/lib/utils"
import type {
  ProtoServiceInfo,
  ProtoSource,
} from "../../../../../packages/types/bindings"
import { MethodMenuHeader } from "./MethodMenuHeader"
import { RPC_KIND, RPC_KINDS } from "./methodKind"

interface Props {
  services: ProtoServiceInfo[]
  service: string | null
  method: string | null
  protoSource: ProtoSource
  onProtoSourceChange: (next: ProtoSource) => void
  refreshing: boolean
  onRefresh: () => void
  error?: string
  onSelect: (service: string, method: string) => void
}

export function MethodMenu({
  services,
  service,
  method,
  protoSource,
  onProtoSourceChange,
  refreshing,
  onRefresh,
  error,
  onSelect,
}: Props) {
  const [filter, setFilter] = useState("")
  const noFiles = protoSource.kind === "files" && protoSource.paths.length === 0

  // Sort services and their methods alphabetically; then narrow by the filter.
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return [...services]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({
        ...s,
        methods: [...s.methods]
          .sort((a, b) => a.name.localeCompare(b.name))
          .filter(
            (m) =>
              !q ||
              s.name.toLowerCase().includes(q) ||
              m.name.toLowerCase().includes(q),
          ),
      }))
      .filter((s) => s.methods.length > 0)
  }, [services, filter])

  return (
    <div className="flex flex-col max-h-[420px]">
      <MethodMenuHeader
        protoSource={protoSource}
        onProtoSourceChange={onProtoSourceChange}
        refreshing={refreshing}
        onRefresh={onRefresh}
        filter={filter}
        onFilter={setFilter}
      />

      <div className="flex-1 min-h-0 overflow-auto py-1">
        {noFiles ? (
          <p className="px-3 py-4 font-mono text-[0.857rem] text-muted text-center">
            Select a .proto file to load methods
          </p>
        ) : groups.length === 0 ? (
          <p
            className={cn(
              "px-3 py-4 font-mono text-[0.857rem] text-center",
              error ? "text-destructive" : "text-muted",
            )}
          >
            {error ?? "No methods discovered"}
          </p>
        ) : (
          groups.map((svc) => (
            <div key={svc.name}>
              <div className="flex items-center justify-between px-3 pt-2 pb-1">
                <span className="font-mono text-[0.72rem] uppercase tracking-wider text-muted truncate">
                  <span className="opacity-60">service </span>
                  {svc.name}
                </span>
                <span className="font-mono text-[0.72rem] text-muted shrink-0 ml-2">
                  {svc.methods.length}
                </span>
              </div>
              {svc.methods.map((m) => {
                const active = svc.name === service && m.name === method
                const meta = RPC_KIND[m.kind]
                return (
                  <button
                    key={m.name}
                    type="button"
                    onClick={() => onSelect(svc.name, m.name)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-1.5 text-left outline-none transition-colors",
                      active ? "bg-accent/15" : "hover:bg-subtle",
                    )}
                  >
                    <Glyph kind={meta.icon} size={15} color={meta.color} />
                    <span
                      className={cn(
                        "font-mono text-[0.857rem] truncate flex-1",
                        active ? "text-accent" : "text-fg",
                      )}
                    >
                      {m.name}
                    </span>
                    {active && (
                      <Glyph kind="check" size={13} color="var(--base0D)" />
                    )}
                  </button>
                )
              })}
            </div>
          ))
        )}
      </div>

      <div className="flex items-center gap-3 px-3 py-2 border-t border-border shrink-0">
        {RPC_KINDS.map((k) => (
          <span key={k} className="flex items-center gap-1.5 shrink-0">
            <Glyph
              kind={RPC_KIND[k].icon}
              size={13}
              color={RPC_KIND[k].color}
            />
            <span className="font-mono text-[0.72rem] text-muted whitespace-nowrap">
              {RPC_KIND[k].label}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}
