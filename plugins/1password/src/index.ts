// Known limitation: like all plugin template functions, op.* resolve only in
// the frontend send path — MCP-triggered sends (Rust-side resolution) expand
// {{ VAR }} tokens and pass function tokens through verbatim.
import type {
  Context,
  TemplateFunctionArg,
  TemplateFunctionContribution,
  VoleeoPlugin,
} from "@voleeo/plugin-api"
import { commands } from "../../../packages/types/bindings"

const ACCOUNT_KEY = "account"

interface StoredAccount {
  value: string
  expiresAt: number | null
}

// The desktop-app SDK needs the 1Password account name (top-left of the app
// sidebar). Ask once, remember in the plugin store per the user's Remember
// choice (same {value, expiresAt} shape as the ask plugin); auth failures
// clear it so the next send re-prompts. The prompt store coalesces identical
// prompts, so parallel tokens in one send yield a single modal.
async function accountName(ctx: Context): Promise<string> {
  const stored = await ctx.store.get<StoredAccount>(ACCOUNT_KEY)
  if (stored?.value) {
    if (stored.expiresAt === null || stored.expiresAt > Date.now()) {
      return stored.value
    }
    await ctx.store.delete(ACCOUNT_KEY)
  }
  const result = await ctx.prompt.ask({
    title: "1Password account name",
    placeholder: "as shown in the 1Password app sidebar",
  })
  const name = result?.value.trim()
  if (!result || !name) {
    throw new DOMException("1Password account prompt cancelled", "AbortError")
  }
  if (result.remember === "forever") {
    await ctx.store.set<StoredAccount>(ACCOUNT_KEY, { value: name, expiresAt: null })
  } else if (result.remember === "expire" && result.expiresInMs && result.expiresInMs > 0) {
    await ctx.store.set<StoredAccount>(ACCOUNT_KEY, {
      value: name,
      expiresAt: Date.now() + result.expiresInMs,
    })
  }
  return name
}

// Coalesce concurrent renders of the same reference (e.g. one send using a
// secret twice) into a single bridge call. No TTL cache on purpose — the
// bridge process keeps the 1Password authorization window alive, and we don't
// want to retain plaintext secrets.
const inflight = new Map<string, Promise<string>>()

async function readRef(ctx: Context, ref: string): Promise<string> {
  const existing = inflight.get(ref)
  if (existing) return existing
  const p = (async () => {
    const account = await accountName(ctx)
    const res = await commands.opRead(ref, account)
    if (res.status === "error") {
      const err = res.error
      const msg = "data" in err && typeof err.data === "string" ? err.data : null
      // not_found marks an authorization failure (denied prompt, wrong account
      // name, SDK integration disabled) — forget the account so the next send
      // asks again, and tell the user why.
      if (err.kind === "not_found") {
        await ctx.store.delete(ACCOUNT_KEY)
        ctx.toast.show({
          kind: "error",
          message: `1Password authorization failed: ${msg ?? "unknown error"}`,
        })
      }
      throw new Error(msg ?? "1Password read failed")
    }
    return res.data
  })().finally(() => inflight.delete(ref))
  inflight.set(ref, p)
  return p
}

function requireArg(args: Record<string, string>, name: string): string {
  const value = normalize(args[name] ?? "")
  if (!value) throw new Error(`1Password: "${name}" is required`)
  return value
}

/** Trim and strip one pair of wrapping quotes — refs copied from docs or
 *  shell snippets often arrive as `"op://…"`. */
export function normalize(raw: string): string {
  const t = raw.trim()
  const m = t.match(/^(["'])(.*)\1$/s)
  return (m ? m[2] : t).trim()
}

export function refError(raw: string): string | null {
  const ref = normalize(raw)
  if (!ref.startsWith("op://")) {
    return "Expected a secret reference like op://vault/item/field"
  }
  const segments = ref.slice("op://".length).split("/")
  if (segments.length < 3 || segments.some((s) => !s.trim())) {
    return "Reference needs vault, item and field: op://vault/item/field"
  }
  return null
}

function segmentError(value: string): string | null {
  return normalize(value).includes("/") ? "Must not contain a slash" : null
}

const vaultItemArgs: TemplateFunctionArg[] = [
  {
    name: "vault",
    label: "Vault",
    type: "text",
    required: true,
    placeholder: "prod",
    row: "ref",
    validate: segmentError,
  },
  {
    name: "item",
    label: "Item",
    type: "text",
    required: true,
    placeholder: "db",
    row: "ref",
    validate: segmentError,
  },
]

function helper(name: string, label: string, field: string): TemplateFunctionContribution {
  return {
    name: `op.${name}`,
    label,
    description: `Reads the ${name} field of a 1Password item via the desktop app.`,
    previewable: false,
    args: vaultItemArgs,
    onRender: (ctx, args) =>
      readRef(ctx, `op://${requireArg(args, "vault")}/${requireArg(args, "item")}/${field}`),
  }
}

const templateFunctions: TemplateFunctionContribution[] = [
  {
    name: "op.read",
    label: "Read a 1Password secret reference",
    description:
      "Resolves an op://vault/item/field secret reference through the 1Password " +
      "desktop app (authorized with Touch ID / Windows Hello).",
    previewable: false,
    args: [
      {
        name: "ref",
        label: "Secret reference",
        type: "text",
        required: true,
        placeholder: "op://vault/item/field",
        validate: refError,
      },
    ],
    onRender: (ctx, args) => readRef(ctx, requireArg(args, "ref")),
  },
  helper("password", "Read an item's password", "password"),
  helper("username", "Read an item's username", "username"),
  helper("otp", "Read an item's one-time password", "one-time password?attribute=otp"),
]

export const plugin: VoleeoPlugin = {
  meta: {
    id: "@voleeo/1password",
    name: "1Password",
    version: "1.0.0",
    author: "Voleeo",
  },
  templateFunctions,
}
