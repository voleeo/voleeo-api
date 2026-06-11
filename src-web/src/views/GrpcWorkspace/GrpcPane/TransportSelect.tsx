import { Glyph } from "@/components/Glyph"
import { C_GRPC } from "@/components/tokens"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

const OPTIONS: { tls: boolean; label: string; sub: string }[] = [
  { tls: false, label: "Plaintext", sub: "Unencrypted" },
  { tls: true, label: "TLS", sub: "Encrypted" },
]

export function TransportSelect({
  tls,
  disabled,
  onChange,
}: {
  tls: boolean
  disabled?: boolean
  onChange: (tls: boolean) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        title="Transport"
        className="self-stretch flex items-center gap-1 px-2.5 editor-font font-semibold border-r border-border shrink-0 tracking-wide cursor-pointer outline-none disabled:cursor-default hover:bg-subtle transition-colors"
        style={{ color: C_GRPC, fontSize: "0.786rem" }}
      >
        gRPC
        {tls && <Glyph kind="shield-check" size={13} color="currentColor" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="uppercase tracking-wider">
            Transport
          </DropdownMenuLabel>
          {OPTIONS.map((o) => {
            const active = o.tls === tls
            return (
              <DropdownMenuItem
                key={o.label}
                className="cursor-pointer focus:bg-subtle grid grid-cols-[18px_1fr_16px] items-center gap-2 py-1.5"
                onClick={() => {
                  if (!active) onChange(o.tls)
                }}
              >
                <Glyph
                  kind={o.tls ? "shield-check" : "shield-slash"}
                  size={15}
                  color={active ? "var(--base0D)" : "var(--base04)"}
                />
                <div className="flex flex-col leading-tight">
                  <span
                    className={cn(
                      "font-sans text-[0.857rem]",
                      active ? "text-accent" : "text-fg",
                    )}
                  >
                    {o.label}
                  </span>
                  <span className="font-mono text-[0.72rem] text-muted">
                    {o.sub}
                  </span>
                </div>
                {active && (
                  <Glyph kind="check" size={13} color="var(--base0D)" />
                )}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
