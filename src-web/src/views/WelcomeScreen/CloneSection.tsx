import { Glyph } from "@/components/Glyph"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { FlowBtn } from "./FlowBtn"
import { CARD, isValidRepoUrl, Section } from "./ImportHomeUi"

const INPUT =
  "w-full bg-bg border border-border rounded-[6px] px-2.5 py-2 text-[0.857rem] text-fg font-mono outline-none focus:border-accent"

function ErrorLine({ msg }: { msg: string }) {
  return (
    <div className="text-[0.786rem] text-error border border-error/50 rounded-[4px] px-2.5 py-2">
      {msg}
    </div>
  )
}

interface Props {
  cloneUrl: string
  onCloneUrlChange: (v: string) => void
  onCloneParentReset: () => void
  showCreds: boolean
  cloneUser: string
  onCloneUserChange: (v: string) => void
  cloneToken: string
  onCloneTokenChange: (v: string) => void
  cloneLoading: boolean
  onClone: () => void
  error: string | null
}

/** "Clone a git repository" card: URL input, optional creds, clone button. */
export function CloneSection({
  cloneUrl,
  onCloneUrlChange,
  onCloneParentReset,
  showCreds,
  cloneUser,
  onCloneUserChange,
  cloneToken,
  onCloneTokenChange,
  cloneLoading,
  onClone,
  error,
}: Props) {
  const urlValid = isValidRepoUrl(cloneUrl)
  const showUrlError = cloneUrl.trim().length > 0 && !urlValid

  return (
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
                onCloneUrlChange(e.target.value)
                onCloneParentReset()
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && urlValid) onClone()
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
              onChange={(e) => onCloneUserChange(e.target.value)}
              placeholder="Username"
              className={INPUT}
            />
            <input
              type="password"
              value={cloneToken}
              onChange={(e) => onCloneTokenChange(e.target.value)}
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
          <FlowBtn onClick={onClone} disabled={cloneLoading || !urlValid}>
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

        {error && <ErrorLine msg={error} />}
      </div>
    </Section>
  )
}
