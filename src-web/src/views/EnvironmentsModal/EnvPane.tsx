import { useCallback, useState } from "react"
import { Glyph } from "@/components/Glyph"
import { cn } from "@/lib/utils"
import type { Environment, EnvironmentVariable } from "@/store/environment"
import { useEnvironmentStore } from "@/store/environment"
import { SystemEnvBlock } from "./SystemEnvBlock"
import { TextEditor } from "./TextEditor"
import { VariablesEditor } from "./VariablesEditor"
import { propagateVariableRename } from "./VariablesEditor/propagateRename"

type ViewMode = "form" | "text"

const SCOPES = [
  {
    shared: false,
    label: "Local",
    title: "Local — stays on this machine, never synced.",
  },
  {
    shared: true,
    label: "Shared",
    title: "Shared — synced with the workspace folder via git.",
  },
] as const

export function EnvPane({
  env,
  focusKey,
  focusSystem = false,
  flashNonce,
}: {
  env: Environment
  focusKey?: string
  focusSystem?: boolean
  flashNonce?: number
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("form")
  const update = useEnvironmentStore((s) => s.update)

  function setShared(shared: boolean) {
    if (shared === env.shared) return
    void update({ ...env, shared }).catch(() => {})
  }

  const saveVars = useCallback(
    (variables: EnvironmentVariable[]) => {
      void update({ ...env, variables }).catch(() => {})
    },
    [env, update],
  )
  const renameVar = useCallback(
    (oldKey: string, newKey: string) =>
      propagateVariableRename(env.workspaceId, oldKey, newKey, env.id),
    [env.workspaceId, env.id],
  )

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between">
        <span className="font-sans text-[0.857rem] text-muted font-medium uppercase tracking-wide">
          Variables
        </span>
        <div className="flex items-center gap-1">
          <div
            role="radiogroup"
            aria-label="Environment scope"
            className="flex items-center gap-0.5 rounded-[6px] border border-border bg-bg p-[2px]"
          >
            {SCOPES.map((s) => {
              const active = env.shared === s.shared
              return (
                <button
                  key={s.label}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setShared(s.shared)}
                  title={s.title}
                  className={cn(
                    "flex items-center px-2.5 py-0.5 rounded-[4px] border-0 outline-none cursor-pointer font-sans text-[0.857rem] transition-colors",
                    active
                      ? "bg-accent/15 text-accent"
                      : "bg-transparent text-muted hover:text-fg",
                  )}
                >
                  {s.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {env.kind === "global" && (
        <SystemEnvBlock
          key={env.workspaceId}
          workspaceId={env.workspaceId}
          flashKey={focusSystem ? focusKey : undefined}
          flashNonce={flashNonce}
        />
      )}

      {viewMode === "form" ? (
        <VariablesEditor
          source={env.variables}
          updatedAt={env.updatedAt}
          onSave={saveVars}
          onRename={renameVar}
          focusKey={focusSystem ? undefined : focusKey}
          flashNonce={flashNonce}
        />
      ) : (
        <TextEditor env={env} />
      )}

      <div className="mt-auto flex justify-end">
        <button
          type="button"
          onClick={() => setViewMode((m) => (m === "form" ? "text" : "form"))}
          title={
            viewMode === "form" ? "Switch to text view" : "Switch to form view"
          }
          className="flex items-center gap-1.5 px-2 py-1 rounded-[5px] border-0 outline-none cursor-pointer hover:bg-subtle bg-transparent text-muted hover:text-fg transition-colors"
        >
          <Glyph
            kind={viewMode === "form" ? "code" : "list"}
            size={13}
            color="var(--base04)"
          />
          <span className="font-sans text-[0.857rem]">
            {viewMode === "form" ? "Text view" : "Form view"}
          </span>
        </button>
      </div>
    </div>
  )
}
