import { Glyph } from "@/components/Glyph"
import { Button } from "@/components/ui/button"
import { useGitStore } from "@/store/git"

export function InitPanel() {
  const repo = useGitStore((s) => s.repo)
  const op = useGitStore((s) => s.op)
  const init = useGitStore((s) => s.init)
  const notEncrypted = repo ? !repo.encrypted : false
  const hasUnencryptedSecrets = repo?.unencryptedSecrets ?? false

  return (
    <div className="h-full grid place-items-center bg-bg">
      <div className="max-w-[460px] flex flex-col items-center gap-4 px-6 text-center">
        <Glyph kind="commit" size={40} color="var(--base04)" />
        <div>
          <h2 className="font-sans text-lg text-fg">
            Track this workspace with Git
          </h2>
          <p className="text-sm text-muted mt-1">
            Initialize a repository to review changes, keep history, and
            collaborate. Each request is its own file, so merges stay granular.
          </p>
        </div>

        {notEncrypted && (
          <div className="w-full text-left rounded-md border border-warn/40 bg-warn/10 p-3 flex gap-3 items-start">
            <Glyph kind="warning" size={24} color="var(--base0A)" />
            <div className="text-[0.8rem] text-fg">
              This workspace is <strong>not encrypted</strong> —{" "}
              {hasUnencryptedSecrets
                ? "auth secrets would be committed as plaintext."
                : "any auth secrets you add later will be committed as plaintext."}{" "}
              Enable encryption in Workspace Settings → Storage first so they're
              stored as ciphertext.
            </div>
          </div>
        )}

        <Button
          onClick={() => init()}
          disabled={op === "init"}
          className="cursor-pointer hover:bg-primary/90"
        >
          {op === "init" ? "Initializing…" : "Initialize repository"}
        </Button>
      </div>
    </div>
  )
}
