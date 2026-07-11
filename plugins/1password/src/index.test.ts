// @ts-expect-error — bun:test lacks TS types in this workspace
import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { Context } from "@voleeo/plugin-api"

// Mock the bindings module BEFORE importing the plugin so the plugin's
// `commands` import binds to the mock.
const opReadMock = mock(async (_reference: string, _account: string) => ({
  status: "ok" as const,
  data: "s3cret",
}))

mock.module("../../../packages/types/bindings", () => ({
  commands: {
    opRead: opReadMock,
  },
}))

import { normalize, plugin, refError } from "./index"

function fn(name: string) {
  const f = plugin.templateFunctions?.find((f) => f.name === name)
  if (!f) throw new Error(`template function "${name}" not found`)
  return f
}

// In-memory plugin store + scripted prompt, mirroring the fake-Context pattern
// from plugins/ask.
let stored = new Map<string, unknown>()
let promptResult: { value: string; remember: string; expiresInMs?: number } | null = null
const toastMock = mock((_opts: { message: string; kind?: string }) => {})
const askMock = mock(async () => promptResult)

const ctx = {
  toast: { show: toastMock },
  prompt: { ask: askMock },
  store: {
    get: async (k: string) => stored.get(k),
    set: async (k: string, v: unknown) => void stored.set(k, v),
    delete: async (k: string) => void stored.delete(k),
  },
} as unknown as Context

async function renderError(name: string, args: Record<string, string>): Promise<Error> {
  try {
    await fn(name).onRender(ctx, args)
  } catch (e) {
    return e as Error
  }
  throw new Error("expected onRender to throw")
}

beforeEach(() => {
  opReadMock.mockClear()
  toastMock.mockClear()
  askMock.mockClear()
  stored = new Map([["account", { value: "Acme", expiresAt: null }]])
  promptResult = null
})

describe("plugin meta", () => {
  test("has correct id and four functions", () => {
    expect(plugin.meta.id).toBe("@voleeo/1password")
    expect(plugin.templateFunctions).toHaveLength(4)
  })

  test("no function is previewable (renders trigger biometrics)", () => {
    for (const f of plugin.templateFunctions ?? []) {
      expect(f.previewable).toBe(false)
    }
  })
})

describe("account name", () => {
  test("uses the stored account without prompting", async () => {
    await fn("op.read").onRender(ctx, { ref: "op://a/b/c" })
    expect(askMock).not.toHaveBeenCalled()
    expect(opReadMock).toHaveBeenCalledWith("op://a/b/c", "Acme")
  })

  test("prompts once and stores the entered account forever", async () => {
    stored.delete("account")
    promptResult = { value: " My Account ", remember: "forever" }
    await fn("op.read").onRender(ctx, { ref: "op://a/b/c" })
    expect(opReadMock).toHaveBeenCalledWith("op://a/b/c", "My Account")
    expect(stored.get("account")).toEqual({ value: "My Account", expiresAt: null })
  })

  test("remember 'never' → account used but not stored", async () => {
    stored.delete("account")
    promptResult = { value: "Temp", remember: "never" }
    await fn("op.read").onRender(ctx, { ref: "op://a/b/c" })
    expect(opReadMock).toHaveBeenCalledWith("op://a/b/c", "Temp")
    expect(stored.has("account")).toBe(false)
  })

  test("remember 'expire' → stored with expiresAt", async () => {
    stored.delete("account")
    promptResult = { value: "Acme", remember: "expire", expiresInMs: 60_000 }
    const before = Date.now()
    await fn("op.read").onRender(ctx, { ref: "op://a/b/c" })
    const entry = stored.get("account") as { value: string; expiresAt: number }
    expect(entry.value).toBe("Acme")
    expect(entry.expiresAt).toBeGreaterThanOrEqual(before + 60_000)
  })

  test("expired stored account → re-prompts and clears the stale entry", async () => {
    stored.set("account", { value: "Stale", expiresAt: Date.now() - 1 })
    promptResult = { value: "Fresh", remember: "forever" }
    await fn("op.read").onRender(ctx, { ref: "op://a/b/c" })
    expect(askMock).toHaveBeenCalledTimes(1)
    expect(opReadMock).toHaveBeenCalledWith("op://a/b/c", "Fresh")
    expect(stored.get("account")).toEqual({ value: "Fresh", expiresAt: null })
  })

  test("cancelled prompt → AbortError, no IPC", async () => {
    stored.delete("account")
    const error = await renderError("op.read", { ref: "op://a/b/c" })
    expect(error.name).toBe("AbortError")
    expect(opReadMock).not.toHaveBeenCalled()
  })
})

describe("op.read", () => {
  test("resolves the reference", async () => {
    const result = await fn("op.read").onRender(ctx, { ref: "op://prod/db/password" })
    expect(result).toBe("s3cret")
  })

  test("missing ref throws without invoking IPC", async () => {
    const error = await renderError("op.read", {})
    expect(error.message).toContain("required")
    expect(opReadMock).not.toHaveBeenCalled()
  })

  test("auth failure (not_found) → clears account, toasts, throws", async () => {
    opReadMock.mockImplementationOnce(async () => ({
      status: "error",
      error: { kind: "not_found", data: "authorization denied" },
    }))
    const error = await renderError("op.read", { ref: "op://a/b/c" })
    expect(error.message).toBe("authorization denied")
    expect(stored.has("account")).toBe(false)
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock.mock.calls[0][0].kind).toBe("error")
  })

  test("other errors → throw, account kept, no toast", async () => {
    opReadMock.mockImplementationOnce(async () => ({
      status: "error",
      error: { kind: "invalid_config", data: "no item" },
    }))
    const error = await renderError("op.read", { ref: "op://a/b/c" })
    expect(error.message).toBe("no item")
    expect(stored.get("account")).toEqual({ value: "Acme", expiresAt: null })
    expect(toastMock).not.toHaveBeenCalled()
  })

  test("concurrent renders of the same ref coalesce into one IPC call", async () => {
    const f = fn("op.read")
    const [a, b] = await Promise.all([
      f.onRender(ctx, { ref: "op://a/b/c" }),
      f.onRender(ctx, { ref: "op://a/b/c" }),
    ])
    expect(a).toBe("s3cret")
    expect(b).toBe("s3cret")
    expect(opReadMock).toHaveBeenCalledTimes(1)
  })
})

describe("helpers build the expected references", () => {
  const cases: Array<[string, string]> = [
    ["op.password", "op://prod/db/password"],
    ["op.username", "op://prod/db/username"],
    ["op.otp", "op://prod/db/one-time password?attribute=otp"],
  ]

  for (const [name, expectedRef] of cases) {
    test(`${name} → ${expectedRef}`, async () => {
      await fn(name).onRender(ctx, { vault: "prod", item: "db" })
      expect(opReadMock).toHaveBeenCalledWith(expectedRef, "Acme")
    })
  }

  test("empty vault throws without invoking IPC", async () => {
    const error = await renderError("op.password", { vault: " ", item: "db" })
    expect(error.message).toContain("vault")
    expect(opReadMock).not.toHaveBeenCalled()
  })
})

describe("normalize", () => {
  test("strips wrapping double or single quotes and whitespace", () => {
    expect(normalize(' "op://a/b/c" ')).toBe("op://a/b/c")
    expect(normalize("'op://a/b/c'")).toBe("op://a/b/c")
    expect(normalize("op://a/b/c")).toBe("op://a/b/c")
  })

  test("keeps unbalanced or inner quotes", () => {
    expect(normalize('"op://a/b/c')).toBe('"op://a/b/c')
    expect(normalize('a"b')).toBe('a"b')
  })
})

describe("refError", () => {
  test("accepts valid references, quoted or not", () => {
    expect(refError("op://vault/item/field")).toBeNull()
    expect(refError('"op://vault/item/section/field"')).toBeNull()
    expect(refError("op://prod/db/one-time password?attribute=otp")).toBeNull()
  })

  test("rejects missing scheme and short paths", () => {
    expect(refError("vault/item/field")).toContain("op://")
    expect(refError("op://vault/item")).toContain("vault, item and field")
    expect(refError("op://vault//field")).toContain("vault, item and field")
  })
})

describe("pasted quoted refs resolve", () => {
  test("op.read strips wrapping quotes before IPC", async () => {
    await fn("op.read").onRender(ctx, { ref: '"op://Personal/Apo-discounter/username"' })
    expect(opReadMock).toHaveBeenCalledWith("op://Personal/Apo-discounter/username", "Acme")
  })

  test("validate hooks are wired on ref, vault and item args", () => {
    expect(fn("op.read").args?.[0].validate?.("nope")).toContain("op://")
    for (const name of ["op.password", "op.username", "op.otp"]) {
      for (const arg of fn(name).args ?? []) {
        expect(arg.validate?.("has/slash")).toContain("slash")
        expect(arg.validate?.("clean")).toBeNull()
      }
    }
  })
})
