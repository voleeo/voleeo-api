import { Glyph } from "@/components/Glyph"
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { formatKeyCombo, SHORTCUTS } from "@/config/shortcuts"
import type { GitOp, GitRepoInfo } from "@/store/git"
import type { GitBranch } from "@/store/gitBranches"
import { getUpdates, share } from "@/store/gitReview"
import { BranchSubmenu } from "../BranchSubmenu"
import { ITEM, openGitWindow } from "../gitMenu"

export function SourceControlMenuItems({
  workspaceId,
  repo,
  op,
  conflicted,
  changeCount,
  branch,
  branches,
  onNewBranch,
  onRenameBranch,
  onConnectRemote,
  onOpenSettings,
}: {
  workspaceId: string
  repo: GitRepoInfo | null
  op: GitOp | null
  conflicted: boolean
  changeCount: number
  branch: string | null
  branches: GitBranch[]
  onNewBranch: () => void
  onRenameBranch: () => void
  onConnectRemote: () => void
  onOpenSettings: () => void
}) {
  return (
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
        <DropdownMenuItem className={ITEM} onClick={onConnectRemote}>
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
        onNewBranch={onNewBranch}
        onRenameBranch={onRenameBranch}
      />
      <DropdownMenuSeparator />
      <DropdownMenuItem className={ITEM} onClick={onOpenSettings}>
        <Glyph kind="settings" size={13} color="var(--base04)" />
        Settings
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}
