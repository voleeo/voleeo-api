import { open } from "@tauri-apps/plugin-dialog"
import { useState } from "react"
import { useShallow } from "zustand/shallow"
import { Glyph } from "@/components/Glyph"
import { Spinner } from "@/components/ui/spinner"
import { errorMessage } from "@/lib/error"
import { cn } from "@/lib/utils"
import { useUiStore } from "@/store/workspace"
import { commands } from "../../../../packages/types/bindings"
import { CloneSection } from "./CloneSection"
import { FlowBtn } from "./FlowBtn"
import { FlowShell } from "./FlowShell"
import { CARD, IconBox, Section } from "./ImportHomeUi"
import { ImportRequestsFlow } from "./import/ImportRequestsFlow"

type ErrorScope = "open" | "clone"

function ErrorLine({ msg }: { msg: string }) {
  return (
    <div className="text-[0.786rem] text-error border border-error/50 rounded-[4px] px-2.5 py-2">
      {msg}
    </div>
  )
}

interface ImportFlowProps {
  onCancel: () => void
}

export function ImportFlow({ onCancel }: ImportFlowProps) {
  const { openWorkspace, loadWorkspaces } = useUiStore(
    useShallow((s) => ({
      openWorkspace: s.openWorkspace,
      loadWorkspaces: s.loadWorkspaces,
    })),
  )
  const [folderLoading, setFolderLoading] = useState(false)
  const [error, setError] = useState<{ scope: ErrorScope; msg: string } | null>(
    null,
  )
  const [cloneUrl, setCloneUrl] = useState("")
  const [cloneParent, setCloneParent] = useState<string | null>(null)
  const [showCreds, setShowCreds] = useState(false)
  const [cloneUser, setCloneUser] = useState("")
  const [cloneToken, setCloneToken] = useState("")
  const [cloneLoading, setCloneLoading] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  if (importOpen) {
    return <ImportRequestsFlow onCancel={() => setImportOpen(false)} />
  }

  // Returns the error message (and surfaces it) or null on success.
  async function adopt(
    scope: ErrorScope,
    run: () => Promise<
      | { status: "ok"; data: { id: string } }
      | { status: "error"; error: unknown }
    >,
  ): Promise<string | null> {
    const res = await run()
    if (res.status === "ok") {
      await loadWorkspaces()
      openWorkspace(res.data.id, "api")
      return null
    }
    const msg = errorMessage(res.error as never)
    setError({ scope, msg })
    return msg
  }

  async function handleOpenFolder() {
    setError(null)
    const selected = await open({ directory: true, multiple: false })
    if (!selected) return
    const folderPath = typeof selected === "string" ? selected : selected[0]
    setFolderLoading(true)
    try {
      await adopt("open", () => commands.workspaceOpenFolder(folderPath))
    } finally {
      setFolderLoading(false)
    }
  }

  async function handleClone() {
    const url = cloneUrl.trim()
    if (!url) return
    setError(null)
    let parent = cloneParent
    if (!parent) {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose where to clone the repository",
      })
      if (!selected) return
      parent = typeof selected === "string" ? selected : selected[0]
      setCloneParent(parent)
    }
    setCloneLoading(true)
    try {
      const msg = await adopt("clone", () =>
        commands.gitCloneWorkspace(
          url,
          parent,
          cloneUser.trim() || null,
          cloneToken.trim() || null,
        ),
      )
      if (msg && /auth|credential|ssh/i.test(msg)) setShowCreds(true)
      else if (msg) setCloneParent(null)
    } finally {
      setCloneLoading(false)
    }
  }

  return (
    <FlowShell
      icon="import"
      title="Import"
      description="Open an existing workspace folder, clone a repository, or import requests."
      wide
      footer={
        <div className="flex items-center w-full">
          <FlowBtn onClick={onCancel}>Cancel</FlowBtn>
        </div>
      }
    >
      <Section label="Open a folder">
        <div className={cn(CARD, "flex flex-col gap-3 mb-4")}>
          <div className="flex items-center gap-4">
            <IconBox kind="folder" />
            <div className="flex-1 min-w-0">
              <div className="font-sans text-[0.95rem] font-semibold text-fg">
                Open a folder
              </div>
              <div className="text-[0.786rem] text-muted">
                Your workspace already lives in a folder on this machine.
              </div>
            </div>
            <FlowBtn onClick={handleOpenFolder} disabled={folderLoading}>
              {folderLoading ? (
                <>
                  <Spinner className="size-3 shrink-0" /> Opening
                </>
              ) : (
                "Choose folder…"
              )}
            </FlowBtn>
          </div>
          {error?.scope === "open" && <ErrorLine msg={error.msg} />}
        </div>
      </Section>

      <CloneSection
        cloneUrl={cloneUrl}
        onCloneUrlChange={setCloneUrl}
        onCloneParentReset={() => setCloneParent(null)}
        showCreds={showCreds}
        cloneUser={cloneUser}
        onCloneUserChange={setCloneUser}
        cloneToken={cloneToken}
        onCloneTokenChange={setCloneToken}
        cloneLoading={cloneLoading}
        onClone={handleClone}
        error={error?.scope === "clone" ? error.msg : null}
      />

      <Section label="Import requests">
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className={cn(
            CARD,
            "w-full flex items-center gap-4 text-left cursor-pointer outline-none hover:border-accent/60 transition-colors",
          )}
        >
          <IconBox kind="import" accent />
          <div className="flex-1 min-w-0">
            <div className="font-sans text-[0.95rem] font-semibold text-fg">
              Import requests
            </div>
            <div className="text-[0.786rem] text-muted">
              OpenAPI · Swagger · Postman · Insomnia
            </div>
          </div>
          <Glyph kind="arrow" size={16} color="var(--base04)" />
        </button>
      </Section>
    </FlowShell>
  )
}
