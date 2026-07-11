// Sidecar bridging Voleeo's Rust backend to the 1Password desktop app.
// Protocol: JSON lines over stdio.
//   request  {"id":1,"account":"My Account","ref":"op://vault/item/field"}
//   response {"id":1,"ok":true,"value":"…"} | {"id":1,"ok":false,"error":"…","auth":bool}
// `auth: true` marks failures from client creation/authorization (wrong account
// name, denied prompt, SDK integration disabled) so the plugin can re-prompt.
import { createInterface } from "node:readline"
import * as sdk from "@1password/sdk"

export class AuthError extends Error {}

export type Resolver = (account: string, ref: string) => Promise<string>

// SDK errors arrive verbose, e.g. "An error occurred when processing SDK
// request: Error { msg: Account not found, inner: None }". Surface just the
// `msg`, and drop the boilerplate prefix otherwise.
export function cleanError(message: string): string {
  const msg = message.match(/\bmsg:\s*(.+?),\s*inner:/s)
  if (msg) return msg[1].trim()
  return message.replace(/^An error occurred when processing SDK request:\s*/i, "").trim()
}

export async function processLine(line: string, resolve: Resolver): Promise<string> {
  let id = 0
  try {
    const req = JSON.parse(line)
    id = typeof req.id === "number" ? req.id : 0
    if (!req.account || !req.ref) throw new Error("account and ref are required")
    const value = await resolve(req.account, req.ref)
    return JSON.stringify({ id, ok: true, value })
  } catch (e) {
    return JSON.stringify({
      id,
      ok: false,
      error: cleanError(e instanceof Error ? e.message : String(e)),
      auth: e instanceof AuthError,
    })
  }
}

// One client per account, kept for the process lifetime — desktop-app
// authorization is bound to this process, so a warm client avoids re-prompting.
const clients = new Map<string, Promise<sdk.Client>>()

function clientFor(account: string): Promise<sdk.Client> {
  let client = clients.get(account)
  if (!client) {
    client = sdk.createClient({
      auth: new sdk.DesktopAuth(account),
      integrationName: "Voleeo",
      integrationVersion: "v1.0.0",
    })
    // A failed client (denied prompt, bad account) must not poison the cache.
    client.catch(() => clients.delete(account))
    clients.set(account, client)
  }
  return client
}

async function sdkResolve(account: string, ref: string): Promise<string> {
  let client: sdk.Client
  try {
    client = await clientFor(account)
  } catch (e) {
    throw new AuthError(e instanceof Error ? e.message : String(e))
  }
  return client.secrets.resolve(ref)
}

// Each read is a ~800ms IPC roundtrip to the desktop app, so cache resolved
// values briefly to make repeat sends instant. Only successful reads are cached
// (a throw never populates it); the bridge already holds a live authorized
// client for the auth window, so this doesn't widen access — just latency.
export function cachedResolver(
  inner: Resolver,
  ttlMs = 30_000,
  now: () => number = Date.now,
): Resolver {
  const cache = new Map<string, { value: string; expires: number }>()
  return async (account, ref) => {
    const key = `${account}\n${ref}`
    const t = now()
    const hit = cache.get(key)
    if (hit && hit.expires > t) return hit.value
    const value = await inner(account, ref)
    cache.set(key, { value, expires: t + ttlMs })
    return value
  }
}

if (import.meta.main) {
  // Exit only once stdin is closed AND all in-flight requests have answered —
  // the SDK client keeps live handles, so the loop never drains on its own.
  let pending = 0
  let closed = false
  const maybeExit = () => {
    if (closed && pending === 0) process.exit(0)
  }
  const resolve = cachedResolver(sdkResolve)
  const rl = createInterface({ input: process.stdin })
  rl.on("line", (line) => {
    if (!line.trim()) return
    pending++
    void processLine(line, resolve)
      .then((out) => process.stdout.write(`${out}\n`))
      .finally(() => {
        pending--
        maybeExit()
      })
  })
  rl.on("close", () => {
    closed = true
    maybeExit()
  })
}
