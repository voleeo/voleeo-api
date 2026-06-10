import { useCallback, useEffect, useState } from "react"
import { Glyph } from "@/components/Glyph"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatKeyCombo, SHORTCUTS } from "@/config/shortcuts"
import { useKeydown } from "@/hooks/useKeydown"
import { cn } from "@/lib/utils"
import { useGitStore } from "@/store/git"
import { type GitBranch, listBranches } from "@/store/gitBranches"
import { getUpdates, share } from "@/store/gitReview"
import { useUiStore } from "@/store/workspace"
import { GitSettings } from "@/views/GitSync/GitSettings"
import { RemoteSetup } from "@/views/GitSync/RemoteSetup"
import { NewBranchModal, RenameBranchModal } from "./BranchModals"
import { BranchSubmenu } from "./BranchSubmenu"
import { ITEM, openGitWindow } from "./gitMenu"

export function SourceControlMenu() {
  const workspaceId = useUiStore((s) => s.activeWorkspaceId)
  const repo = useGitStore((s) => s.repo)
  const op = useGitStore((s) => s.op)
  const authPrompt = useGitStore((s) => s.authPrompt)
  const changeCount = useGitStore((s) => s.files.length)
  const conflicted = useGitStore(
    (s) => s.entityConflicts.length > 0 || (s.repo?.merging ?? false),
  )
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [newOpen, setNewOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [remoteOpen, setRemoteOpen] = useState(false)

  const onMenuOpenChange = useCallback(
    (open: boolean) => {
      if (!open || !workspaceId) return
      const git = useGitStore.getState()
      git.reloadRepo(workspaceId)
      git.refresh(workspaceId)
      listBranches(workspaceId)
        .then(setBranches)
        .catch(() => {})
    },
    [workspaceId],
  )

  const isRepo = repo?.isRepo ?? false
  const branch = repo?.branch ?? null

  // Auth failures (push/pull) open Git settings with the message.
  useEffect(() => {
    if (authPrompt) setSettingsOpen(true)
  }, [authPrompt])

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-list when the current branch changes
  useEffect(() => {
    if (workspaceId && isRepo) {
      listBranches(workspaceId)
        .then(setBranches)
        .catch(() => {})
    } else {
      setBranches([])
    }
  }, [workspaceId, isRepo, branch])

  // ⌘⇧U pulls the latest — only with a remote and no update already running.
  useKeydown(
    SHORTCUTS.GIT_UPDATE,
    () => getUpdates(),
    isRepo && (repo?.hasRemote ?? false) && op !== "update",
  )

  // ⌘⇧P pushes — only when there's a remote with local commits ahead.
  useKeydown(
    SHORTCUTS.GIT_PUSH,
    () => share(),
    isRepo &&
      (repo?.hasRemote ?? false) &&
      (repo?.ahead ?? 0) > 0 &&
      op !== "share",
  )

  // ⌘⇧C opens Changes / Resolve conflicts — only when there's something to act on.
  useKeydown(
    SHORTCUTS.GIT_CHANGES,
    () => {
      if (workspaceId) openGitWindow(workspaceId, "changes")
    },
    isRepo && (conflicted || changeCount > 0),
  )

  // ⌘⇧H opens the commit history.
  useKeydown(
    SHORTCUTS.GIT_HISTORY,
    () => {
      if (workspaceId) openGitWindow(workspaceId, "history")
    },
    isRepo,
  )

  function closeSettings() {
    setSettingsOpen(false)
    useGitStore.setState({ authPrompt: null })
  }

  if (!workspaceId) return null

  // Red on conflict, green with local changes, neutral when clean.
  const stateColor = conflicted
    ? "var(--base08)"
    : changeCount > 0
      ? "var(--base0B)"
      : "var(--base04)"

  const TRIGGER =
    "flex items-center gap-1.5 h-7 px-2 rounded-[5px] cursor-pointer bg-transparent border-0 outline-none hover:bg-subtle"

  // Before the workspace is set up for sync, the control is a plain button that
  // opens the window (where the user can start syncing) — no branch, no menu.
  if (!isRepo) {
    return (
      <button
        type="button"
        title="Git Sync"
        onClick={() => openGitWindow(workspaceId)}
        className={TRIGGER}
      >
        <Glyph kind="branch" size={14} color={stateColor} />
        <span
          className="font-sans text-[0.786rem]"
          style={{ color: stateColor }}
        >
          Git Sync
        </span>
      </button>
    )
  }

  return (
    <>
      <DropdownMenu onOpenChange={onMenuOpenChange}>
        <DropdownMenuTrigger
          title="Git Sync"
          className={cn(TRIGGER, "data-[popup-open]:bg-subtle")}
        >
          <Glyph kind="branch" size={14} color={stateColor} />
          {branch && (
            <span
              className="font-sans text-[0.786rem] max-w-[120px] truncate"
              style={{ color: stateColor }}
            >
              {branch}
            </span>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[200px]">
          <DropdownMenuItem
            className={ITEM}
            disabled={!conflicted && changeCount === 0}
            onClick={() => openGitWindow(workspaceId, "changes")}
          >
            {conflicted ? (
              <>
                <Glyph kind="warning" size={13} color="var(--base08)" />
                Resolve conflicts
              </>
            ) : (
              <>
                <Glyph kind="commit" size={13} color="var(--base04)" />
                {changeCount === 0 ? "No changes" : "Changes"}
              </>
            )}
            <span className="ml-auto font-mono text-[0.714rem] tracking-[0.2em] text-muted">
              {formatKeyCombo(SHORTCUTS.GIT_CHANGES)}
            </span>
          </DropdownMenuItem>
          {repo?.hasRemote && (repo?.ahead ?? 0) > 0 && (
            <DropdownMenuItem
              className={ITEM}
              disabled={op === "share"}
              onClick={() => share()}
            >
              <Glyph kind="upload" size={13} color="var(--base04)" />
              Push
              <span className="ml-auto inline-flex items-center gap-2">
                <span
                  className="inline-flex items-center justify-center min-w-[17px] h-[16px] px-1 rounded-full text-[0.68rem] font-bold"
                  style={{
                    color: "var(--base0B)",
                    background:
                      "color-mix(in oklch, var(--base0B) 18%, transparent)",
                  }}
                >
                  {repo?.ahead}
                </span>
                <span className="font-mono text-[0.714rem] tracking-[0.2em] text-muted">
                  {formatKeyCombo(SHORTCUTS.GIT_PUSH)}
                </span>
              </span>
            </DropdownMenuItem>
          )}
          {repo?.hasRemote ? (
            <DropdownMenuItem
              className={ITEM}
              disabled={op === "update"}
              onClick={() => getUpdates()}
            >
              <Glyph kind="arrow-down" size={13} color="var(--base04)" />
              Update
              <span className="ml-auto font-mono text-[0.714rem] tracking-[0.2em] text-muted">
                {formatKeyCombo(SHORTCUTS.GIT_UPDATE)}
              </span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              className={ITEM}
              onClick={() => setRemoteOpen(true)}
            >
              <Glyph kind="globe" size={13} color="var(--base04)" />
              Connect remote
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className={ITEM}
            onClick={() => openGitWindow(workspaceId, "history")}
          >
            <Glyph kind="history" size={13} color="var(--base04)" />
            History
            <span className="ml-auto font-mono text-[0.714rem] tracking-[0.2em] text-muted">
              {formatKeyCombo(SHORTCUTS.GIT_HISTORY)}
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <BranchSubmenu
            workspaceId={workspaceId}
            branch={branch}
            branches={branches}
            onNewBranch={() => setNewOpen(true)}
            onRenameBranch={() => setRenameOpen(true)}
          />
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className={ITEM}
            onClick={() => setSettingsOpen(true)}
          >
            <Glyph kind="settings" size={13} color="var(--base04)" />
            Settings
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {newOpen && (
        <NewBranchModal
          workspaceId={workspaceId}
          onClose={() => setNewOpen(false)}
        />
      )}
      {renameOpen && branch && (
        <RenameBranchModal
          workspaceId={workspaceId}
          current={branch}
          onClose={() => setRenameOpen(false)}
        />
      )}
      {remoteOpen && <RemoteSetup onClose={() => setRemoteOpen(false)} />}
      {settingsOpen && (
        <GitSettings onClose={closeSettings} message={authPrompt} />
      )}
    </>
  )
}
