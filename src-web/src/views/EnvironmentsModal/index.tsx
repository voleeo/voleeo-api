import { useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { Glyph } from "@/components/Glyph"
import { ManagementModal } from "@/components/ManagementModal"
import { type Environment, useEnvironmentStore } from "@/store/environment"
import { EnvPane } from "./EnvPane"
import type { EnvFocusTarget } from "./focusTarget"
import { InlineNewEnvItem } from "./InlineNewEnvItem"
import { NavEnvItem } from "./NavEnvItem"

interface Props {
  workspaceId: string
  onClose: () => void
  focusVariable?: EnvFocusTarget & { envId?: string }
}

function resolveFocusEnvId(
  environments: Environment[],
  activeEnvId: string | null,
  key: string,
): string | null {
  const has = (e: Environment) => e.variables.some((v) => v.key === key)
  const active = environments.find((e) => e.id === activeEnvId && has(e))
  if (active) return active.id
  const global = environments.find((e) => e.kind === "global" && has(e))
  if (global) return global.id
  return environments.find(has)?.id ?? null
}

function resolveInitialEnvId(
  environments: Environment[],
  activeEnvId: string | null,
  focusVariable: Props["focusVariable"],
): string | null {
  const globalId = environments.find((e) => e.kind === "global")?.id ?? null
  if (focusVariable) {
    const { envId, key, system } = focusVariable
    if (envId) return envId
    // System vars live in the global env's System block.
    if (system) return globalId
    const found = resolveFocusEnvId(environments, activeEnvId, key)
    if (found) return found
  }
  const active = environments.find((e) => e.id === activeEnvId)
  return active?.id ?? globalId ?? environments[0]?.id ?? null
}

export function EnvironmentsModal({
  workspaceId,
  onClose,
  focusVariable,
}: Props) {
  const { environments, activeEnvId } = useEnvironmentStore(
    useShallow((s) => ({
      environments: s.environments,
      activeEnvId: s.activeEnvId,
    })),
  )
  const [isCreating, setIsCreating] = useState(false)

  const globalEnv = environments.find((e) => e.kind === "global") ?? null

  const [selectedId, setSelectedId] = useState<string | null>(() =>
    resolveInitialEnvId(environments, activeEnvId, focusVariable),
  )

  // Re-select when focusVariable changes after mount.
  useEffect(() => {
    if (!focusVariable) return
    const { envId, key, system } = focusVariable
    if (envId) {
      setSelectedId(envId)
      return
    }
    if (system) {
      setSelectedId(globalEnv?.id ?? null)
      return
    }
    const found = resolveFocusEnvId(environments, activeEnvId, key)
    if (found) setSelectedId(found)
  }, [focusVariable, environments, activeEnvId, globalEnv?.id])

  const selectedEnv = environments.find((e) => e.id === selectedId) ?? null
  const personalEnvs = environments.filter((e) => e.kind !== "global")

  function handleDeleted() {
    setSelectedId(
      globalEnv?.id ??
        personalEnvs.find((e) => e.id !== selectedId)?.id ??
        null,
    )
  }

  return (
    <ManagementModal
      onClose={onClose}
      title={
        <span className="font-sans text-[1rem] font-semibold text-fg">
          Environments
        </span>
      }
    >
      <div className="w-60 border-r border-border flex flex-col shrink-0 py-3 gap-y-1 overflow-y-auto">
        {globalEnv && (
          <>
            <NavEnvItem
              env={globalEnv}
              isActive={selectedId === globalEnv.id}
              onClick={() => setSelectedId(globalEnv.id)}
              onDeleted={handleDeleted}
            />
            {(personalEnvs.length > 0 || isCreating) && (
              <div className="mx-3 my-1 border-t border-border" />
            )}
          </>
        )}

        {personalEnvs.map((env) => (
          <NavEnvItem
            key={env.id}
            env={env}
            isActive={selectedId === env.id}
            onClick={() => setSelectedId(env.id)}
            onDeleted={handleDeleted}
          />
        ))}

        {isCreating && (
          <InlineNewEnvItem
            workspaceId={workspaceId}
            onCreated={(id) => {
              setSelectedId(id)
              setIsCreating(false)
            }}
            onCancel={() => setIsCreating(false)}
          />
        )}

        <button
          type="button"
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2 mx-2 mt-1 px-3 py-[6px] rounded-md cursor-pointer bg-transparent hover:bg-subtle outline-none transition-colors border-0"
        >
          <Glyph kind="plus" size={12} color="var(--base04)" />
          <span className="font-sans text-[0.929rem] text-muted">
            New Environment
          </span>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden p-5">
        {selectedEnv ? (
          <EnvPane
            key={selectedEnv.id}
            env={selectedEnv}
            focusKey={focusVariable?.key}
            focusSystem={focusVariable?.system ?? false}
            flashNonce={focusVariable?.nonce}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted font-sans text-[0.929rem]">
            Select an environment
          </div>
        )}
      </div>
    </ManagementModal>
  )
}
