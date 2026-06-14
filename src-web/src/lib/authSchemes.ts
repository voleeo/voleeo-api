import type { AuthConfig } from "@/store/requests"

export type AuthKind = AuthConfig["kind"]

export type AuthProtocol = "http" | "ws" | "grpc"

interface AuthScheme {
  kind: AuthKind
  label: string
  description: string
  protocols: readonly AuthProtocol[]
  dynamic: boolean
  fresh: () => AuthConfig
}

const ALL_PROTOCOLS: readonly AuthProtocol[] = ["http", "ws", "grpc"]
const HTTP_ONLY: readonly AuthProtocol[] = ["http"]

export const AUTH_SCHEMES: Record<AuthKind, AuthScheme> = {
  none: {
    kind: "none",
    label: "No Auth",
    description: "No authentication is sent with the request.",
    protocols: ALL_PROTOCOLS,
    dynamic: false,
    fresh: () => ({ kind: "none" }),
  },
  inherit: {
    kind: "inherit",
    label: "Inherit",
    description: "Use the auth defined on the parent folder or the workspace.",
    protocols: ALL_PROTOCOLS,
    dynamic: false,
    fresh: () => ({ kind: "inherit", from: "folder" }),
  },
  basic: {
    kind: "basic",
    label: "Basic Auth",
    description:
      "Sends username and password Base64-encoded in the Authorization header.",
    protocols: ALL_PROTOCOLS,
    dynamic: false,
    fresh: () => ({ kind: "basic", username: "", password: "" }),
  },
  bearer: {
    kind: "bearer",
    label: "Bearer Token",
    description: "Sends the token as “Authorization: Bearer <token>”.",
    protocols: ALL_PROTOCOLS,
    dynamic: false,
    fresh: () => ({ kind: "bearer", token: "" }),
  },
  api_key: {
    kind: "api_key",
    label: "API Key",
    description: "Sends a key/value pair as a header or query parameter.",
    protocols: ALL_PROTOCOLS,
    dynamic: false,
    fresh: () => ({ kind: "api_key", key: "", value: "", location: "header" }),
  },
  aws_sig_v4: {
    kind: "aws_sig_v4",
    label: "AWS Signature v4",
    description:
      "Signs the request with AWS credentials at send time over its final method, URL, and body.",
    protocols: HTTP_ONLY,
    dynamic: true,
    fresh: () => ({
      kind: "aws_sig_v4",
      access_key: "",
      secret_key: "",
      session_token: "",
      region: "",
      service: "",
    }),
  },
  oauth1: {
    kind: "oauth1",
    label: "OAuth 1.0",
    description:
      "Signs the request with OAuth 1.0 credentials into the Authorization header at send time.",
    protocols: HTTP_ONLY,
    dynamic: true,
    fresh: () => ({
      kind: "oauth1",
      consumer_key: "",
      consumer_secret: "",
      token: "",
      token_secret: "",
      signature_method: "hmac_sha1",
      realm: "",
    }),
  },
  oauth2: {
    kind: "oauth2",
    label: "OAuth 2.0",
    description:
      "Fetches and caches an access token, then sends it as a Bearer header.",
    protocols: HTTP_ONLY,
    dynamic: false,
    fresh: () => ({
      kind: "oauth2",
      grant_type: "client_credentials",
      auth_url: "",
      token_url: "",
      client_id: "",
      client_secret: "",
      scope: "",
      audience: "",
      client_auth: "basic_header",
      use_pkce: true,
      code_challenge_method: "s256",
      code_verifier: "",
      username: "",
      password: "",
    }),
  },
  digest: {
    kind: "digest",
    label: "Digest Auth",
    description:
      "Answers the server's Digest challenge automatically — one extra round-trip on the first send.",
    protocols: HTTP_ONLY,
    dynamic: true,
    fresh: () => ({ kind: "digest", username: "", password: "" }),
  },
  ntlm: {
    kind: "ntlm",
    label: "NTLM",
    description:
      "Runs the NTLMv2 handshake over a dedicated connection (Windows / IIS intranets). HTTP/1.1 only.",
    protocols: HTTP_ONLY,
    dynamic: true,
    fresh: () => ({
      kind: "ntlm",
      username: "",
      password: "",
      domain: "",
      workstation: "",
    }),
  },
}

export const SELECTABLE_AUTH_KINDS: readonly AuthKind[] = [
  "none",
  "basic",
  "bearer",
  "api_key",
  "aws_sig_v4",
  "oauth1",
  "oauth2",
  "digest",
  "ntlm",
]

export function freshAuth(kind: AuthKind): AuthConfig {
  return AUTH_SCHEMES[kind].fresh()
}

export function authLabel(kind: AuthKind): string {
  return AUTH_SCHEMES[kind].label
}

export function authDescription(kind: AuthKind): string {
  return AUTH_SCHEMES[kind].description
}

export function schemeSupports(
  kind: AuthKind,
  protocol: AuthProtocol,
): boolean {
  return AUTH_SCHEMES[kind].protocols.includes(protocol)
}

export function isDynamicScheme(kind: AuthKind): boolean {
  return AUTH_SCHEMES[kind].dynamic
}

export function isConcreteScheme(kind: AuthKind): boolean {
  return kind !== "none" && kind !== "inherit"
}

export function isAuthEnabled(auth: AuthConfig): boolean {
  switch (auth.kind) {
    case "bearer":
    case "basic":
    case "api_key":
    case "aws_sig_v4":
    case "oauth1":
    case "oauth2":
    case "digest":
    case "ntlm":
      return auth.enabled ?? true
    default:
      return true
  }
}

export function setAuthEnabled(auth: AuthConfig, enabled: boolean): AuthConfig {
  switch (auth.kind) {
    case "bearer":
    case "basic":
    case "api_key":
    case "aws_sig_v4":
    case "oauth1":
    case "oauth2":
    case "digest":
    case "ntlm":
      return { ...auth, enabled }
    default:
      return auth
  }
}
