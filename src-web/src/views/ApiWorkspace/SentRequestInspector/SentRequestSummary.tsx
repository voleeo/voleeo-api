import { type ReactNode, useState } from "react"
import { Glyph } from "@/components/Glyph"
import { MethodPill } from "@/components/MethodPill"
import { cn } from "@/lib/utils"
import { useRequestStore } from "@/store/requests"
import type { SentRequestSnapshot } from "./types"

function SectionLabel({
  children,
  count,
  trailing,
  noDivider,
}: {
  children: string
  count?: number
  trailing?: ReactNode
  noDivider?: boolean
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="font-sans text-[0.714rem] uppercase tracking-[1.4px] text-muted/70 font-semibold">
        {children}
      </span>
      {count != null && (
        <span className="font-mono text-[0.714rem] text-muted/70">{count}</span>
      )}
      {trailing}
      {!noDivider && <span className="flex-1 h-px bg-border" />}
    </div>
  )
}

function FormatBadge({ kind }: { kind: string }) {
  return (
    <span className="inline-flex items-center px-1.5 py-px font-mono text-[0.643rem] uppercase tracking-[0.5px] font-bold rounded-[3px] border border-accent/30 text-accent bg-accent/10">
      {kind}
    </span>
  )
}

function Line({
  name,
  value,
  sub,
  secret,
  defaultMasked,
}: {
  name: string
  value: string
  sub?: ReactNode
  secret?: boolean
  defaultMasked?: boolean
}) {
  const [show, setShow] = useState(false)
  const hidden = secret && defaultMasked && !show
  return (
    <div className="grid grid-cols-[160px_1fr] gap-3 items-baseline py-[5px]">
      <div className="font-mono text-[0.857rem] font-semibold text-fg break-words min-w-0">
        {name}
      </div>
      <div className="flex flex-col gap-[2px] min-w-0">
        <div className="flex items-baseline gap-2 min-w-0">
          <span
            className={cn(
              "flex-1 font-mono text-[0.857rem] text-muted break-words leading-[1.5]",
              hidden && "tracking-[1px]",
            )}
          >
            {hidden ? "••••••••••••••••" : value || "—"}
          </span>
          {secret && defaultMasked && (
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="text-muted/70 hover:text-fg rounded-[3px] cursor-pointer outline-none border-0 bg-transparent shrink-0 w-5 h-5 inline-flex items-center justify-center"
              aria-label={show ? "Hide value" : "Reveal value"}
            >
              <Glyph
                kind={show ? "hide" : "view"}
                size={11}
                color="currentColor"
              />
            </button>
          )}
        </div>
        {sub && (
          <div className="font-mono text-[0.714rem] text-muted/70">{sub}</div>
        )}
      </div>
    </div>
  )
}

function UrlHeadline({ method, fullUrl }: { method: string; fullUrl: string }) {
  // Split base from query for the dimmed-tail effect.
  const qIdx = fullUrl.indexOf("?")
  const base = qIdx === -1 ? fullUrl : fullUrl.slice(0, qIdx)
  const query = qIdx === -1 ? "" : fullUrl.slice(qIdx)
  return (
    <div className="flex items-baseline gap-2.5">
      <MethodPill method={method} />
      <div className="flex-1 min-w-0 font-mono text-[0.929rem] leading-[1.5] text-fg break-all">
        {base}
        {query && <span className="text-muted/70">{query}</span>}
      </div>
    </div>
  )
}

function BodyCard({ text }: { text: string }) {
  return (
    <div className="px-3 py-2.5 bg-bg border border-border rounded-[5px]">
      <pre className="m-0 font-mono text-[0.857rem] leading-[1.6] text-muted whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto">
        {text}
      </pre>
    </div>
  )
}

function EmptyHint({ children }: { children: string }) {
  return (
    <div className="font-sans text-[0.857rem] text-muted/70 py-1">
      {children}
    </div>
  )
}

/** Where on the wire the resolved auth lands. The inheritance prefix is
 *  rendered separately by `AuthSub` so the folder can be a link. */
function authDestination(
  auth: SentRequestSnapshot["resolvedAuth"],
): string | undefined {
  switch (auth.kind) {
    case "bearer":
    case "basic":
      return "Encoded into Authorization header"
    case "api_key":
      return auth.apiKeyLocation === "query"
        ? "Appended to the URL query string"
        : "Sent as a request header"
    case "inherit":
      // Reached only when inheritance couldn't resolve to a real source.
      return "No folder or workspace defines an auth"
    default:
      return undefined
  }
}

/** Sub-line under the Auth value: an "Inherited from …" prefix (folder shown as
 *  a link that opens that folder) followed by the on-the-wire destination. */
function AuthSub({ auth }: { auth: SentRequestSnapshot["resolvedAuth"] }) {
  const setActiveFolder = useRequestStore((s) => s.setActiveFolder)
  const destination = authDestination(auth)
  if (!destination) return null

  const folderId = auth.inheritedFromFolderId
  const folderName = auth.inheritedFromFolderName

  return (
    <>
      {folderName ? (
        <>
          Inherited from folder{" "}
          {folderId ? (
            <button
              type="button"
              onClick={() => setActiveFolder(folderId)}
              className="text-accent hover:underline cursor-pointer outline-none border-0 bg-transparent p-0 font-mono"
            >
              {folderName}
            </button>
          ) : (
            folderName
          )}
          {" > "}
        </>
      ) : auth.inheritedFromWorkspace ? (
        "Inherited from workspace > "
      ) : null}
      {destination}
    </>
  )
}

export function SentRequestSummary({
  snapshot,
  maskSecrets = true,
  className,
}: {
  snapshot: SentRequestSnapshot
  /** Mask `auth`-origin header values by default (per-row eye reveal). */
  maskSecrets?: boolean
  className?: string
}) {
  const hasBody = !!snapshot.body?.text
  const cookies = snapshot.cookies
  const authKindLabel = (() => {
    switch (snapshot.resolvedAuth.kind) {
      case "none":
        return "No authentication"
      case "bearer":
        return "Bearer"
      case "basic":
        return "Basic"
      case "api_key":
        return "API key"
      case "aws_sig_v4":
        return "AWS SigV4"
      case "inherit":
        return "Inherit"
    }
  })()

  return (
    <div className={cn("flex flex-col gap-4 px-4 py-4", className)}>
      <UrlHeadline method={snapshot.method} fullUrl={snapshot.fullUrl} />

      <div>
        <SectionLabel count={snapshot.headers.length}>Headers</SectionLabel>
        {snapshot.headers.length === 0 ? (
          <EmptyHint>No headers</EmptyHint>
        ) : (
          snapshot.headers.map((h, i) => (
            <Line
              // biome-ignore lint/suspicious/noArrayIndexKey: snapshot is immutable per render
              key={`${h.name}:${i}`}
              name={h.name}
              value={h.value}
              secret={h.origin.kind === "auth"}
              defaultMasked={maskSecrets}
            />
          ))
        )}
      </div>

      <div>
        <SectionLabel>Auth</SectionLabel>
        {snapshot.resolvedAuth.kind === "none" ? (
          <EmptyHint>No authentication will be sent</EmptyHint>
        ) : (
          <Line
            name={authKindLabel}
            value={snapshot.resolvedAuth.summary}
            sub={<AuthSub auth={snapshot.resolvedAuth} />}
          />
        )}
      </div>

      <div>
        <SectionLabel count={cookies.length}>Cookies</SectionLabel>
        {cookies.length === 0 ? (
          <EmptyHint>No cookies</EmptyHint>
        ) : (
          cookies.map((c, i) => (
            <Line
              // biome-ignore lint/suspicious/noArrayIndexKey: snapshot is immutable per render
              key={`${c.name}:${i}`}
              name={c.name}
              value={c.value}
              sub={
                c.path && c.path !== "/"
                  ? `${c.domain}${c.path}`
                  : c.domain || undefined
              }
            />
          ))
        )}
      </div>

      <div>
        <SectionLabel
          noDivider
          trailing={
            hasBody && snapshot.body?.kind ? (
              <FormatBadge kind={snapshot.body.kind} />
            ) : undefined
          }
        >
          Body
        </SectionLabel>
        {hasBody && snapshot.body?.text ? (
          <BodyCard text={snapshot.body.text} />
        ) : (
          <EmptyHint>No body</EmptyHint>
        )}
      </div>
    </div>
  )
}
