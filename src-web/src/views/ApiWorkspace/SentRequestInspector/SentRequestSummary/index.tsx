import { cn } from "@/lib/utils"
import type { SentRequestSnapshot } from "../types"
import { AuthSub } from "./AuthSection"
import { BodyCard } from "./BodyCard"
import { EmptyHint, FormatBadge, Line, SectionLabel } from "./primitives"
import { UrlHeadline } from "./UrlHeadline"

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
      case "oauth1":
        return "OAuth 1.0"
      case "oauth2":
        return "OAuth 2.0"
      case "digest":
        return "Digest"
      case "ntlm":
        return "NTLM"
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
