import { open } from "@tauri-apps/plugin-dialog"
import { useState } from "react"
import { useShallow } from "zustand/shallow"
import { Glyph } from "@/components/Glyph"
import { Spinner } from "@/components/ui/spinner"
import { errorMessage } from "@/lib/error"
import { cn } from "@/lib/utils"
import { useUiStore } from "@/store/workspace"
import { commands } from "../../../../packages/types/bindings"
import { FlowBtn } from "./FlowBtn"
import { FlowShell } from "./FlowShell"
import { CARD, IconBox, isValidRepoUrl, Section } from "./ImportHomeUi"
import { ImportRequestsFlow } from "./import/ImportRequestsFlow"

const INPUT =
  "w-full bg-bg border border-border rounded-[6px] px-2.5 py-2 text-[0.857rem] text-fg font-mono outline-none focus:border-accent"

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

  const urlValid = isValidRepoUrl(cloneUrl)
  const showUrlError = cloneUrl.trim().length > 0 && !urlValid

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

      <Section label="Clone a git repository">
        <div className={cn(CARD, "flex flex-col gap-4 mb-4")}>
          <div className="flex flex-col gap-1.5">
            <span className="text-[0.786rem] text-fg">
              Repository URL <span className="text-muted">(SSH or HTTPS)</span>
            </span>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <Glyph kind="branch" size={14} color="var(--base04)" />
              </span>
              <input
                value={cloneUrl}
                onChange={(e) => {
                  setCloneUrl(e.target.value)
                  setCloneParent(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && urlValid) handleClone()
                }}
                placeholder="git@github.com:your-org/api-requests.git"
                className={cn(
                  INPUT,
                  "pl-9",
                  showUrlError && "border-error/60 focus:border-error",
                )}
              />
            </div>
            {showUrlError && (
              <span className="text-[0.714rem] text-error">
                Enter a valid Git URL — SSH (git@host:org/repo.git) or HTTPS
                (https://host/org/repo.git).
              </span>
            )}
          </div>

          {showCreds && (
            <div className="flex gap-2">
              <input
                value={cloneUser}
                onChange={(e) => setCloneUser(e.target.value)}
                placeholder="Username"
                className={INPUT}
              />
              <input
                type="password"
                value={cloneToken}
                onChange={(e) => setCloneToken(e.target.value)}
                placeholder="Personal access token"
                className={INPUT}
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.786rem] text-muted">
              {showCreds
                ? "Token is used to clone over HTTPS."
                : "Uses your SSH agent or git credential helper."}
            </span>
            <FlowBtn onClick={handleClone} disabled={cloneLoading || !urlValid}>
              {cloneLoading ? (
                <>
                  <Spinner className="size-3 shrink-0" /> Cloning
                </>
              ) : (
                <>
                  <Glyph kind="folder" size={14} color="var(--base05)" />
                  Clone
                </>
              )}
            </FlowBtn>
          </div>

          {error?.scope === "clone" && <ErrorLine msg={error.msg} />}
        </div>
      </Section>

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
