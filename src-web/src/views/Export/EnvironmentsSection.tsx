import type { ReactNode } from "react"
import { Switch } from "@/components/ui/switch"
import { SectionLabel } from "./parts"

export function EnvironmentsSection({
  includeEnvironments,
  includePrivate,
  privateAvail,
  setIncludeEnvironments,
  setIncludePrivate,
  children,
}: {
  includeEnvironments: boolean
  includePrivate: boolean
  privateAvail: number
  setIncludeEnvironments: (v: boolean) => void
  setIncludePrivate: (v: boolean) => void
  children?: ReactNode
}) {
  return (
    <div>
      <SectionLabel>Environments</SectionLabel>
      <div className="overflow-hidden rounded-xl border border-border bg-bg/40">
        <div
          onClick={() => setIncludeEnvironments(!includeEnvironments)}
          className="flex cursor-pointer items-center gap-4 p-4"
        >
          <div className="min-w-0 flex-1">
            <div className="text-sm text-fg">Include environments</div>
            <div className="mt-0.5 text-[12.5px] leading-snug text-muted">
              Export environments and their variables alongside the requests.
              Off by default.
            </div>
          </div>
          <span onClick={(e) => e.stopPropagation()}>
            <Switch
              checked={includeEnvironments}
              onCheckedChange={setIncludeEnvironments}
              size="sm"
            />
          </span>
        </div>

        {includeEnvironments && (
          <div
            onClick={() => setIncludePrivate(!includePrivate)}
            className="flex cursor-pointer items-center gap-4 border-t border-border p-4"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm text-fg">
                Include private environments
              </div>
              <div className="mt-0.5 text-[12.5px] leading-snug text-muted">
                Personal, unshared environments stored only on this machine.
                {privateAvail
                  ? ` ${privateAvail} in this selection.`
                  : " None in this selection."}
              </div>
            </div>
            <span onClick={(e) => e.stopPropagation()}>
              <Switch
                checked={includePrivate}
                onCheckedChange={setIncludePrivate}
                size="sm"
              />
            </span>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
