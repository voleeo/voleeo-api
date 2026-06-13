import { listen } from "@tauri-apps/api/event"
import { useCallback, useEffect, useRef, useState } from "react"
import { Glyph } from "@/components/Glyph"
import { useTemplateInputData } from "@/components/TemplateInput/useTemplateInputData"
import { cn } from "@/lib/utils"
import {
  type Oauth2TokenStatus,
  oauth2ClearToken,
  oauth2FetchToken,
  oauth2Status,
  oauth2TokenDetails,
  resolveOAuth2Templates,
} from "@/store/oauth2"
import type { AuthConfig } from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import { TokenDetails } from "./TokenDetails"

type OAuth2 = Extract<AuthConfig, { kind: "oauth2" }>

function describe(status: Oauth2TokenStatus | null): {
  dot: string
  text: string
} {
  if (!status?.hasToken) return { dot: "bg-muted", text: "No token" }
  if (status.expiresAt == null)
    return { dot: "bg-success", text: "Token valid" }
  const secondsLeft = status.expiresAt - Date.now() / 1000
  if (secondsLeft <= 0) return { dot: "bg-warn", text: "Token expired" }
  const mins = Math.round(secondsLeft / 60)
  const left =
    mins >= 60 ? `${Math.round(mins / 60)}h` : `${Math.max(mins, 1)}m`
  return { dot: "bg-success", text: `Token valid · expires in ${left}` }
}

export function TokenPanel({ auth }: { auth: OAuth2 }) {
  const workspaceId = useUiStore((s) => s.activeWorkspaceId)
  const [status, setStatus] = useState<Oauth2TokenStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const { activeVars, fns } = useTemplateInputData()
  const [resolved, setResolved] = useState<OAuth2>(auth)
  useEffect(() => {
    let alive = true
    void resolveOAuth2Templates(auth, activeVars, fns).then((r) => {
      if (alive) setResolved(r as OAuth2)
    })
    return () => {
      alive = false
    }
  }, [auth, activeVars, fns])

  const resolvedRef = useRef(resolved)
  resolvedRef.current = resolved
  const reloadStatus = useCallback(async () => {
    if (!workspaceId) return
    try {
      setStatus(await oauth2Status(workspaceId, resolvedRef.current))
    } catch {
      /* status is best-effort */
    }
  }, [workspaceId])

  const cacheId = `${resolved.token_url}|${resolved.client_id}|${resolved.grant_type}|${resolved.scope}|${resolved.audience}`

  // Subscribe once; any flow that acquires a token re-checks status.
  useEffect(() => {
    const un = listen("oauth2:token-acquired", () => void reloadStatus())
    return () => {
      void un.then((f) => f())
    }
  }, [reloadStatus])

  // Re-check on mount and whenever the token identity changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: cacheId is the trigger; the config is read via ref inside reloadStatus
  useEffect(() => {
    void reloadStatus()
  }, [cacheId, reloadStatus])

  const run = async (fn: (ws: string, a: AuthConfig) => Promise<unknown>) => {
    if (!workspaceId) return
    setBusy(true)
    setError(null)
    try {
      await fn(workspaceId, resolved)
      await reloadStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const [copied, setCopied] = useState(false)
  const copyToken = async () => {
    if (!workspaceId) return
    try {
      const details = await oauth2TokenDetails(workspaceId, resolved)
      if (!details) return
      await navigator.clipboard.writeText(details.accessToken)
      setCopied(true)
      setTimeout(() => setCopied(false), 1300)
    } catch {
      /* clipboard/fetch unavailable — no-op */
    }
  }

  const { dot, text } = describe(status)
  const hasToken = !!status?.hasToken
  const autoFetches =
    auth.grant_type === "client_credentials" || auth.grant_type === "password"
  if (!hasToken && autoFetches) return null

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface px-2.5 py-2">
      {hasToken ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="group flex items-center gap-2 w-full text-left p-0 border-0 bg-transparent outline-none cursor-pointer"
        >
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dot)} />
          <span className="font-sans text-[0.857rem] text-fg">{text}</span>
          {status?.tokenPreview && (
            <span className="font-mono text-[0.786rem] text-muted">
              {status.tokenPreview}
            </span>
          )}
          <span
            className="ml-auto shrink-0 inline-flex text-muted group-hover:text-fg transition-[color,transform] duration-100"
            style={{ transform: expanded ? "rotate(90deg)" : "none" }}
          >
            <Glyph kind="chevron" size={12} color="currentColor" />
          </span>
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dot)} />
          <span className="font-sans text-[0.857rem] text-fg">{text}</span>
        </div>
      )}

      <div className="flex items-center gap-1.5">
        {!hasToken && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(oauth2FetchToken)}
            className="inline-flex items-center gap-1 h-6 px-2 rounded-[5px] border border-border bg-bg font-sans text-[0.786rem] text-fg cursor-pointer hover:border-accent/50 disabled:opacity-50 transition-colors"
          >
            <Glyph kind="lightning" size={11} color="currentColor" />
            Get token
          </button>
        )}
        {hasToken && (
          <button
            type="button"
            disabled={busy}
            onClick={copyToken}
            className={cn(
              "inline-flex items-center gap-1 h-6 px-2 rounded-[5px] border bg-bg font-sans text-[0.786rem] cursor-pointer transition-colors outline-none disabled:opacity-50",
              copied
                ? "border-success/40 text-success"
                : "border-border text-muted hover:text-fg",
            )}
          >
            <Glyph
              kind={copied ? "check" : "copy"}
              size={11}
              color="currentColor"
            />
            {copied ? "Copied" : "Copy"}
          </button>
        )}
        {hasToken && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(oauth2ClearToken)}
            className="inline-flex items-center gap-1 h-6 px-2 rounded-[5px] border border-border bg-bg font-sans text-[0.786rem] text-muted cursor-pointer hover:text-error disabled:opacity-50 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {expanded && hasToken && workspaceId && (
        <TokenDetails workspaceId={workspaceId} auth={resolved} />
      )}

      {error && (
        <span className="font-sans text-[0.786rem] text-error leading-snug">
          {error}
        </span>
      )}
    </div>
  )
}
