import { listen } from "@tauri-apps/api/event"
import { useCallback, useEffect, useRef, useState } from "react"
import { JsonView } from "@/components/JsonView"
import { type Oauth2TokenDetails, oauth2TokenDetails } from "@/store/oauth2"
import type { AuthConfig } from "@/store/requests"

type OAuth2 = Extract<AuthConfig, { kind: "oauth2" }>

function toJson(d: Oauth2TokenDetails): string {
  const out: Record<string, unknown> = {
    access_token: d.accessToken,
    token_type: d.tokenType,
    scope: d.scope,
  }
  if (d.expiresAt != null) out.expires_at = d.expiresAt
  if (d.refreshToken) out.refresh_token = d.refreshToken
  return JSON.stringify(out, null, 2)
}

export function TokenDetails({
  workspaceId,
  auth,
}: {
  workspaceId: string
  auth: OAuth2
}) {
  const [details, setDetails] = useState<Oauth2TokenDetails | null>(null)

  const authRef = useRef(auth)
  authRef.current = auth
  const reload = useCallback(async () => {
    try {
      setDetails(await oauth2TokenDetails(workspaceId, authRef.current))
    } catch {
      setDetails(null)
    }
  }, [workspaceId])

  const cacheId = `${auth.token_url}|${auth.client_id}|${auth.grant_type}|${auth.scope}|${auth.audience}`

  useEffect(() => {
    const un = listen("oauth2:token-acquired", () => void reload())
    return () => {
      void un.then((f) => f())
    }
  }, [reload])

  // biome-ignore lint/correctness/useExhaustiveDependencies: cacheId is the trigger; the config is read via ref inside reload
  useEffect(() => {
    void reload()
  }, [cacheId, reload])

  if (!details) return null

  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-sans text-[0.714rem] uppercase tracking-wide text-muted">
        Access token
      </span>
      <div className="selectable-text rounded-[5px] border border-border overflow-hidden max-h-[260px] overflow-y-auto">
        <JsonView value={toJson(details)} />
      </div>
    </div>
  )
}
