import type {
  ProtoSource,
  RequestParameter,
} from "../../../packages/types/bindings"
import { shellTokenize } from "./shellTokenize"

export interface ParsedGrpcRequest {
  target: string
  tls: boolean
  protoSource: ProtoSource
  service: string | null
  method: string | null
  metadata: RequestParameter[]
  message: string
}

/** Value-taking flags whose value we don't model — consumed so the value isn't
 *  mistaken for the target or the service/method positional. */
const SKIP_VALUE_FLAGS = new Set([
  "-authority",
  "-cacert",
  "-cert",
  "-connect-timeout",
  "-format",
  "-keepalive-time",
  "-key",
  "-max-msg-sz",
  "-max-time",
  "-protoset",
  "-protoset-out",
  "-servername",
  "-user-agent",
])

/** Boolean flags we discard. `-plaintext` is handled separately. */
const SKIP_BOOL_FLAGS = new Set([
  "-allow-unknown-fields",
  "-emit-defaults",
  "-expand-headers",
  "-format-error",
  "-help",
  "-insecure",
  "-msg-template",
  "-use-reflection",
  "-v",
  "-version",
  "-vv",
])

/** Header-carrying flags; grpcurl distinguishes their timing, we don't. */
const HEADER_FLAGS = new Set(["-H", "-rpc-header", "-reflect-header"])

function genId(name: string): string {
  return `imp_${name.replace(/[^a-zA-Z0-9]/g, "_")}_${Math.random().toString(36).slice(2, 8)}`
}

function splitHeader(raw: string): RequestParameter | null {
  const idx = raw.indexOf(":")
  if (idx < 0) return null
  const name = raw.slice(0, idx).trim()
  if (!name) return null
  return {
    id: genId(name),
    name,
    value: raw.slice(idx + 1).trimStart(),
    enabled: true,
  }
}

/** `pkg.Service/Method` (what grpcurl prints) or `pkg.Service.Method`. */
function splitSymbol(raw: string): { service: string; method: string } | null {
  const slash = raw.lastIndexOf("/")
  if (slash > 0)
    return { service: raw.slice(0, slash), method: raw.slice(slash + 1) }
  const dot = raw.lastIndexOf(".")
  if (dot > 0) return { service: raw.slice(0, dot), method: raw.slice(dot + 1) }
  return null
}

/** Parse a `grpcurl …` command line into a Voleeo gRPC request shape.
 *  Returns `null` if the input doesn't look like a grpcurl command. */
export function parseGrpcurlCommand(input: string): ParsedGrpcRequest | null {
  const tokens = shellTokenize(input)
  if (!tokens || tokens[0] !== "grpcurl") return null

  let tls = true // grpcurl defaults to TLS; -plaintext opts out
  let message = ""
  const paths: string[] = []
  const includeDirs: string[] = []
  const metadata: RequestParameter[] = []
  const positional: string[] = []

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]

    // grpcurl accepts both `-flag value` and `-flag=value`.
    let flag = token
    let inlineValue: string | null = null
    if (token.startsWith("-")) {
      const eq = token.indexOf("=")
      if (eq > 0) {
        flag = token.slice(0, eq)
        inlineValue = token.slice(eq + 1)
      }
    }
    const nextValue = (): string | null => {
      if (inlineValue !== null) return inlineValue
      i += 1
      return i < tokens.length ? tokens[i] : null
    }

    if (!token.startsWith("-")) {
      positional.push(token)
      continue
    }

    if (flag === "-plaintext") {
      tls = false
    } else if (HEADER_FLAGS.has(flag)) {
      const value = nextValue()
      const header = value && splitHeader(value)
      if (header) metadata.push(header)
    } else if (flag === "-d") {
      const value = nextValue()
      // `-d @` reads the body from stdin — nothing to import.
      if (value && value !== "@") message = value
    } else if (flag === "-proto") {
      const value = nextValue()
      if (value?.trim()) paths.push(value)
    } else if (flag === "-import-path") {
      const value = nextValue()
      if (value?.trim()) includeDirs.push(value)
    } else if (SKIP_VALUE_FLAGS.has(flag)) {
      nextValue()
    } else if (!SKIP_BOOL_FLAGS.has(flag)) {
      // Unknown flag. Assume boolean — consuming the next token would risk
      // eating the target, which is the one thing we can't afford to lose.
    }
  }

  const target = positional[0]
  if (!target) return null

  // `grpcurl <target> list|describe` has no method to import.
  const symbol = positional[1]
  const parts =
    symbol && symbol !== "list" && symbol !== "describe"
      ? splitSymbol(symbol)
      : null

  return {
    target,
    tls,
    protoSource: paths.length
      ? { kind: "files", paths, include_dirs: includeDirs }
      : { kind: "reflection" },
    service: parts?.service ?? null,
    method: parts?.method ?? null,
    metadata,
    message,
  }
}
