import type { AuthConfig } from "@/store/requests"
import type { RequestParameter } from "../../../../../../packages/types/bindings"
import { encodeQueryValue } from "../../paramUtils"
import { authHeader, type ResolveCtx, resolve } from "./context"

/** Auth → a header, or (api_key in query) a `key=value` to append to the URL.
 *  Dynamic schemes (AWS SigV4) can't be reduced to a header here — they sign the
 *  final request — so we resolve their `{{ }}` fields and return the resolved
 *  config in `resolvedAuth` for the backend executor to sign with. */
export async function applyAuth(
  ctx: ResolveCtx,
  auth: AuthConfig,
): Promise<{
  headers: RequestParameter[]
  query?: string
  resolvedAuth?: AuthConfig
}> {
  if (auth.kind === "bearer") {
    const token = await resolve(ctx, auth.token, "Auth: Bearer token")
    return { headers: [authHeader("Authorization", `Bearer ${token}`)] }
  }
  if (auth.kind === "basic") {
    const user = await resolve(ctx, auth.username, "Auth: Basic username")
    const pass = await resolve(ctx, auth.password, "Auth: Basic password")
    const enc = utf8Base64(`${user}:${pass}`)
    return { headers: [authHeader("Authorization", `Basic ${enc}`)] }
  }
  if (auth.kind === "api_key") {
    const key = await resolve(ctx, auth.key, "Auth: API key name")
    const value = await resolve(ctx, auth.value, "Auth: API key value")
    if (!key.trim()) return { headers: [] }
    return auth.location === "query"
      ? {
          headers: [],
          query: `${encodeURIComponent(key)}=${encodeQueryValue(value)}`,
        }
      : { headers: [authHeader(key, value)] }
  }
  if (auth.kind === "aws_sig_v4") {
    const resolvedAuth: AuthConfig = {
      kind: "aws_sig_v4",
      access_key: await resolve(ctx, auth.access_key, "Auth: AWS access key"),
      secret_key: await resolve(ctx, auth.secret_key, "Auth: AWS secret key"),
      secret_key_encrypted: false,
      session_token: auth.session_token
        ? await resolve(ctx, auth.session_token, "Auth: AWS session token")
        : "",
      session_token_encrypted: false,
      region: await resolve(ctx, auth.region, "Auth: AWS region"),
      service: await resolve(ctx, auth.service, "Auth: AWS service"),
    }
    return { headers: [], resolvedAuth }
  }
  if (auth.kind === "oauth1") {
    const resolvedAuth: AuthConfig = {
      kind: "oauth1",
      consumer_key: await resolve(
        ctx,
        auth.consumer_key,
        "Auth: OAuth1 consumer key",
      ),
      consumer_secret: await resolve(
        ctx,
        auth.consumer_secret,
        "Auth: OAuth1 consumer secret",
      ),
      consumer_secret_encrypted: false,
      token: auth.token
        ? await resolve(ctx, auth.token, "Auth: OAuth1 token")
        : "",
      token_secret: auth.token_secret
        ? await resolve(ctx, auth.token_secret, "Auth: OAuth1 token secret")
        : "",
      token_secret_encrypted: false,
      signature_method: auth.signature_method ?? "hmac_sha1",
      realm: auth.realm
        ? await resolve(ctx, auth.realm, "Auth: OAuth1 realm")
        : "",
      private_key: auth.private_key
        ? await resolve(ctx, auth.private_key, "Auth: OAuth1 private key")
        : "",
      private_key_encrypted: false,
      params_location: auth.params_location ?? "header",
      callback: auth.callback
        ? await resolve(ctx, auth.callback, "Auth: OAuth1 callback")
        : "",
      verifier: auth.verifier
        ? await resolve(ctx, auth.verifier, "Auth: OAuth1 verifier")
        : "",
      timestamp: auth.timestamp
        ? await resolve(ctx, auth.timestamp, "Auth: OAuth1 timestamp")
        : "",
      nonce: auth.nonce
        ? await resolve(ctx, auth.nonce, "Auth: OAuth1 nonce")
        : "",
      version: auth.version
        ? await resolve(ctx, auth.version, "Auth: OAuth1 version")
        : "",
    }
    return { headers: [], resolvedAuth }
  }
  if (auth.kind === "digest") {
    const resolvedAuth: AuthConfig = {
      kind: "digest",
      username: await resolve(ctx, auth.username, "Auth: Digest username"),
      password: auth.password
        ? await resolve(ctx, auth.password, "Auth: Digest password")
        : "",
      password_encrypted: false,
    }
    return { headers: [], resolvedAuth }
  }
  if (auth.kind === "ntlm") {
    const r = (v: string | undefined, label: string) =>
      v ? resolve(ctx, v, label) : Promise.resolve("")
    const resolvedAuth: AuthConfig = {
      kind: "ntlm",
      username: await resolve(ctx, auth.username, "Auth: NTLM username"),
      password: await r(auth.password, "Auth: NTLM password"),
      password_encrypted: false,
      domain: await r(auth.domain, "Auth: NTLM domain"),
      workstation: await r(auth.workstation, "Auth: NTLM workstation"),
    }
    return { headers: [], resolvedAuth }
  }
  return { headers: [] }
}

/** `btoa` throws on non-Latin1 input (e.g. non-ASCII creds); encode UTF-8 first. */
function utf8Base64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
