import { useState } from "react"
import { useEnvironmentStore } from "@/store/environment"

const DEFAULT_NEW_ENV_COLOR = "var(--base04)"

interface Props {
  workspaceId: string
  onCreated: (id: string) => void
  onCancel: () => void
}

export function InlineNewEnvItem({ workspaceId, onCreated, onCancel }: Props) {
  const [name, setName] = useState("")
  const create = useEnvironmentStore((s) => s.create)

  async function handleCommit() {
    const trimmed = name.trim()
    if (!trimmed) {
      onCancel()
      return
    }
    const env = await create(workspaceId, {
      name: trimmed,
      color: DEFAULT_NEW_ENV_COLOR,
      shared: false,
    }).catch(() => null)
    if (env) onCreated(env.id)
    else onCancel()
  }

  return (
    <div className="flex items-center gap-2 mx-2 px-2 py-[6px] rounded-md bg-accent/10 w-[calc(100%-16px)]">
      <span
        className="w-3 h-3 rounded-full shrink-0 ring-1 ring-border"
        style={{ background: DEFAULT_NEW_ENV_COLOR }}
      />
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleCommit()
          if (e.key === "Escape") onCancel()
        }}
        onBlur={handleCommit}
        autoComplete="off"
        spellCheck={false}
        placeholder="Environment name"
        className="font-sans text-[0.929rem] text-fg bg-transparent border-0 outline-none flex-1 min-w-0 placeholder:text-muted/50 select-text"
      />
    </div>
  )
}
