import { Glyph } from "@/components/Glyph"
import { useMcpEnabled } from "./useMcpEnabled"

export function McpStatusItem({ onOpen }: { onOpen: () => void }) {
  const enabled = useMcpEnabled() ?? false

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        onOpen()
      }}
      className="w-full flex items-center gap-2 px-2 py-1.5 text-[0.857rem] font-sans text-fg rounded-[4px] cursor-pointer hover:bg-subtle transition-colors border-none bg-transparent text-left"
    >
      <Glyph
        kind={enabled ? "lightning" : "lightning-slash"}
        size={13}
        color={enabled ? "var(--base0B)" : "var(--base08)"}
      />
      MCP Bridge
    </button>
  )
}
