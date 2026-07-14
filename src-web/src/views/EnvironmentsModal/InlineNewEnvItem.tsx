import { InlineNewNavItem } from "@/components/InlineNewNavItem"
import { useEnvironmentStore } from "@/store/environment"

const DEFAULT_NEW_ENV_COLOR = "var(--base04)"

interface Props {
  workspaceId: string
  onCreated: (id: string) => void
  onCancel: () => void
}

export function InlineNewEnvItem({ workspaceId, onCreated, onCancel }: Props) {
  const create = useEnvironmentStore((s) => s.create)

  return (
    <InlineNewNavItem
      placeholder="Environment name"
      dotColor={DEFAULT_NEW_ENV_COLOR}
      onCancel={onCancel}
      onCommit={async (name) => {
        const env = await create(workspaceId, {
          name,
          color: DEFAULT_NEW_ENV_COLOR,
          shared: false,
        }).catch(() => null)
        if (!env) return false
        onCreated(env.id)
        return true
      }}
    />
  )
}
