import { Glyph } from "@/components/Glyph"
import { Checkbox } from "@/components/ui/checkbox"
import type { ExportTarget } from "../../../../packages/types/bindings"
import { Meta, Pill } from "./parts"

export function WorkspaceRow({
  target,
  active,
  checked,
  includeEnvironments,
  includePrivate,
  onToggle,
}: {
  target: ExportTarget
  active: boolean
  checked: boolean
  includeEnvironments: boolean
  includePrivate: boolean
  onToggle: () => void
}) {
  const envs = includeEnvironments
    ? target.sharedEnvs + (includePrivate ? target.privateEnvs : 0)
    : 0
  const secrets =
    target.inlineSecrets +
    (includeEnvironments
      ? target.sharedSecrets + (includePrivate ? target.privateSecrets : 0)
      : 0)

  return (
    <label className="flex h-[52px] w-full cursor-pointer items-center gap-3 rounded-lg px-3.5 text-left transition-colors hover:bg-subtle">
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <Glyph
        kind="folder"
        size={16}
        color={checked ? "var(--base0D)" : "var(--base04)"}
      />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm font-semibold text-fg">
          {target.name}
        </span>
        {active && <Pill>Active</Pill>}
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <Meta
          icon={
            <Glyph kind="arrows-left-right" size={13} color="currentColor" />
          }
        >
          {target.requests}
        </Meta>
        <Meta icon={<Glyph kind="stack" size={13} color="currentColor" />}>
          {envs} env{envs === 1 ? "" : "s"}
        </Meta>
        {secrets > 0 && (
          <Meta
            icon={<Glyph kind="key" size={13} color="currentColor" />}
            tone="text-warn"
          >
            {secrets}
          </Meta>
        )}
      </div>
    </label>
  )
}
