import { useState } from "react"
import { Glyph } from "@/components/Glyph"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { errorMessage } from "@/lib/error"
import { commands } from "../../../../packages/types/bindings"

export function ImportKeyForm({
  workspaceId,
  onImported,
}: {
  workspaceId: string
  onImported: () => void
}) {
  const [value, setValue] = useState("")
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  async function handleImport() {
    setImporting(true)
    setError(null)
    setOk(false)
    try {
      const res = await commands.workspaceImportKey(workspaceId, value)
      if (res.status === "ok") {
        setOk(true)
        setValue("")
        onImported()
        setTimeout(() => setOk(false), 3000)
      } else {
        setError(errorMessage(res.error))
      }
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="border border-border rounded-[8px] p-3.5 flex flex-col gap-2.5 bg-bg">
      <div className="flex items-center gap-1.5">
        <Glyph kind="import" size={13} color="var(--base04)" />
        <span className="font-sans text-[0.857rem] font-semibold text-fg">
          Import encryption key
        </span>
      </div>
      <p className="text-[0.714rem] text-muted leading-relaxed">
        Restore keychain access after a migration or system reinstall by pasting
        your previously saved encryption key.
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-…"
          autoComplete="off"
          spellCheck={false}
          className="flex-1 min-w-0 px-[11px] py-[7px] border border-border rounded-[5px] bg-surface font-mono text-[0.714rem] text-fg outline-none select-text placeholder:text-muted focus:border-accent transition-colors"
        />
        <Button
          variant="outline"
          onClick={handleImport}
          disabled={!value.trim() || importing}
          className="cursor-pointer shrink-0 gap-1.5 border-border text-fg hover:bg-subtle"
        >
          {importing ? (
            <>
              <Spinner className="size-3 shrink-0" />
              Importing
            </>
          ) : (
            "Import"
          )}
        </Button>
      </div>
      {error && (
        <div className="text-[0.786rem] text-error border border-error/50 rounded-[4px] px-2.5 py-1.5">
          {error}
        </div>
      )}
      {ok && (
        <div className="text-[0.786rem] text-success border border-[var(--base0B)]/50 rounded-[4px] px-2.5 py-1.5">
          Key imported successfully.
        </div>
      )}
    </div>
  )
}
