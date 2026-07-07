import { useCallback, useState } from "react"
import type { McpClient } from "./McpClients"

// Lightweight JSON syntax highlighter
// Matches keys, string values, numbers, booleans, and nulls in order.
const JSON_TOKEN =
  /("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g

// Escapes & < > before token-wrapping — quotes are left intact so JSON_TOKEN
// (which matches on `"`) still finds string tokens in the raw JSON.
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function highlightJson(raw: string): string {
  return escapeHtml(raw).replace(JSON_TOKEN, (m) => {
    if (m.startsWith('"')) {
      const isKey = m.endsWith(":")
      const color = isKey ? "var(--base0D)" : "var(--base0B)"
      return `<span style="color:${color}">${m}</span>`
    }
    if (m === "true" || m === "false")
      return `<span style="color:var(--base0E)">${m}</span>`
    if (m === "null") return `<span style="color:var(--base08)">${m}</span>`
    return `<span style="color:var(--base09)">${m}</span>`
  })
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[0.714rem] font-semibold text-muted tracking-widest uppercase mb-2">
      {children}
    </div>
  )
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [text])
  return (
    <button
      type="button"
      onClick={copy}
      className="px-2 py-1 text-[0.786rem] rounded-[3px] border border-border bg-surface text-muted hover:text-fg cursor-pointer transition-colors shrink-0"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  )
}

interface Props {
  client: McpClient
  token: string
  bridgePath: string
  regenerating: boolean
  onRegenerateToken: () => void
}

export function McpClientPanel({
  client,
  token,
  bridgePath,
  regenerating,
  onRegenerateToken,
}: Props) {
  const [tokenVisible, setTokenVisible] = useState(false)
  const snippet = client.getSnippet(
    bridgePath,
    tokenVisible ? token : "<YOUR_TOKEN>",
  )
  const maskedToken = token ? "•".repeat(Math.min(token.length, 40)) : "—"
  const isJson = snippet.trimStart().startsWith("{")

  return (
    <div className="flex-1 min-w-0 p-6 space-y-6">
      {/* Auth token */}
      <div>
        <SectionLabel>Auth Token</SectionLabel>
        <div className="flex items-center gap-2 mb-1.5">
          <code className="flex-1 min-w-0 px-2.5 py-1.5 bg-surface border border-border rounded-[4px] font-mono text-[0.786rem] text-fg overflow-hidden text-ellipsis whitespace-nowrap">
            {tokenVisible ? token : maskedToken}
          </code>
          <button
            type="button"
            onClick={() => setTokenVisible((v) => !v)}
            className="px-2 py-1 text-[0.786rem] rounded-[3px] border border-border bg-surface text-muted hover:text-fg cursor-pointer transition-colors shrink-0"
          >
            {tokenVisible ? "Hide" : "Show"}
          </button>
          <CopyBtn text={token} />
        </div>
        <button
          type="button"
          onClick={onRegenerateToken}
          disabled={regenerating}
          className="text-[0.786rem] text-muted hover:text-fg cursor-pointer transition-colors disabled:opacity-50 border-none bg-transparent p-0"
        >
          {regenerating ? "Regenerating…" : "Regenerate token"}
        </button>
        <p className="mt-1 text-[0.714rem] text-muted leading-snug">
          Invalidates the current token — every connected client must update its
          config with the new token and restart.
        </p>
      </div>

      {/* Instructions */}
      <div>
        <SectionLabel>Instructions</SectionLabel>
        <ol className="space-y-2">
          {client.instructions.map((step, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: static list
              key={i}
              className="flex items-start gap-2.5"
            >
              <span className="shrink-0 w-[18px] h-[18px] rounded-full bg-surface border border-border grid place-items-center text-[0.714rem] text-muted mt-[1px]">
                {i + 1}
              </span>
              <span className="font-sans text-[0.929rem] font-normal text-fg leading-snug">
                {step}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* Snippet */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[0.786rem] font-mono text-muted truncate max-w-[260px]">
            {client.snippetFile}
          </span>
          {/* Copy what's shown: with the token hidden this copies the
              <YOUR_TOKEN> placeholder, so the live secret is never copied by
              surprise. Click Show first to copy a ready-to-paste config. */}
          <CopyBtn text={snippet} />
        </div>
        {isJson ? (
          <pre
            className="px-3 py-2.5 bg-surface border border-border rounded-[4px] font-mono text-[0.75rem] text-fg overflow-x-auto leading-relaxed whitespace-pre"
            // Safe: we build the HTML ourselves from JSON.stringify output
            // biome-ignore lint/security/noDangerouslySetInnerHtml: controlled highlighter
            dangerouslySetInnerHTML={{ __html: highlightJson(snippet) }}
          />
        ) : (
          <pre className="px-3 py-2.5 bg-surface border border-border rounded-[4px] font-mono text-[0.75rem] text-fg overflow-x-auto leading-relaxed whitespace-pre">
            {snippet}
          </pre>
        )}
      </div>
    </div>
  )
}
