import type { Context } from "@voleeo/plugin-api"
import {
  authDisabled,
  resolveParams,
  resolveStr,
  shellQuote,
} from "@voleeo/plugin-api/request"
import type {
  AuthConfig,
  GrpcRequest,
  ProtoSource,
} from "@voleeo/types/bindings"

interface Header {
  name: string
  value: string
}

/** UTF-8 → standard base64 (`btoa` is Latin-1 only). */
function base64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

async function authHeaders(
  ctx: Context,
  auth: AuthConfig | undefined,
): Promise<Header[]> {
  if (!auth || auth.kind === "none" || authDisabled(auth)) return []
  if (auth.kind === "bearer") {
    const token = await resolveStr(ctx, auth.token)
    return [{ name: "authorization", value: `Bearer ${token}` }]
  }
  if (auth.kind === "basic") {
    const user = await resolveStr(ctx, auth.username)
    const pass = await resolveStr(ctx, auth.password ?? "")
    return [
      {
        name: "authorization",
        value: `Basic ${base64Utf8(`${user}:${pass}`)}`,
      },
    ]
  }
  if (auth.kind === "api_key") {
    const name = await resolveStr(ctx, auth.key)
    if (!name.trim()) return []
    return [{ name, value: await resolveStr(ctx, auth.value) }]
  }
  // Inherit is resolved by the host; HTTP-only schemes send nothing (apply_to_grpc).
  return []
}

function protoFlags(source: ProtoSource | undefined): string[] {
  if (!source || source.kind === "reflection") return []
  const flags: string[] = []
  for (const dir of source.include_dirs ?? []) {
    if (dir.trim()) flags.push(`-import-path ${shellQuote(dir)}`)
  }
  for (const path of source.paths ?? []) {
    if (path.trim()) flags.push(`-proto ${shellQuote(path)}`)
  }
  return flags
}

function formatBody(message: string): string {
  const trimmed = message.trim()
  if (!trimmed) return "{}"
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return trimmed
  }
}

/** Serialize a `GrpcRequest` as a POSIX/bash grpcurl command. */
export async function serializeAsGrpcurl(
  request: GrpcRequest,
  ctx: Context,
): Promise<string> {
  const target = await resolveStr(ctx, request.target ?? "")
  const service = (request.service ?? "").trim()
  const method = (request.method ?? "").trim()
  const message = await resolveStr(ctx, request.message ?? "")

  const meta = (await resolveParams(ctx, request.metadata ?? []))
    .filter((p) => p.enabled && p.name.trim())
    .map((p) => ({ name: p.name, value: p.value }))
  const headers = [...meta, ...(await authHeaders(ctx, request.auth))]

  const parts: string[] = ["grpcurl"]
  if (!request.tls) parts.push("-plaintext")
  parts.push(...protoFlags(request.protoSource))
  for (const h of headers) {
    parts.push(`-H ${shellQuote(`${h.name}: ${h.value}`)}`)
  }
  parts.push(`-d ${shellQuote(formatBody(message))}`)
  parts.push(`${shellQuote(target)} ${shellQuote(`${service}/${method}`)}`)

  return [parts[0], ...parts.slice(1).map((p) => `  ${p}`)].join(" \\\n")
}
