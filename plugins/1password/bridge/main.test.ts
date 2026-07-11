// @ts-expect-error — bun:test lacks TS types in this workspace
import { describe, expect, test } from "bun:test"
import { AuthError, cachedResolver, cleanError, processLine, type Resolver } from "./main"

const okResolver: Resolver = async (account, ref) => `${account}:${ref}`

describe("processLine", () => {
  test("resolves a valid request", async () => {
    const out = await processLine(
      JSON.stringify({ id: 7, account: "Acme", ref: "op://v/i/f" }),
      okResolver,
    )
    expect(JSON.parse(out)).toEqual({ id: 7, ok: true, value: "Acme:op://v/i/f" })
  })

  test("missing account/ref → error response with matching id", async () => {
    const out = await processLine(JSON.stringify({ id: 3, ref: "op://v/i/f" }), okResolver)
    const resp = JSON.parse(out)
    expect(resp.id).toBe(3)
    expect(resp.ok).toBe(false)
    expect(resp.auth).toBe(false)
  })

  test("malformed JSON → error response with id 0", async () => {
    const resp = JSON.parse(await processLine("not json", okResolver))
    expect(resp).toMatchObject({ id: 0, ok: false })
  })

  test("resolver failure → ok:false with message, auth:false", async () => {
    const resolver: Resolver = async () => {
      throw new Error("no item")
    }
    const resp = JSON.parse(
      await processLine(JSON.stringify({ id: 1, account: "A", ref: "r" }), resolver),
    )
    expect(resp).toEqual({ id: 1, ok: false, error: "no item", auth: false })
  })

  test("AuthError → auth:true", async () => {
    const resolver: Resolver = async () => {
      throw new AuthError("authorization denied")
    }
    const resp = JSON.parse(
      await processLine(JSON.stringify({ id: 2, account: "A", ref: "r" }), resolver),
    )
    expect(resp).toEqual({ id: 2, ok: false, error: "authorization denied", auth: true })
  })
})

describe("cleanError", () => {
  test("extracts msg from a wrapped SDK error", () => {
    expect(
      cleanError(
        "An error occurred when processing SDK request: Error { msg: Account not found, inner: None }",
      ),
    ).toBe("Account not found")
  })

  test("strips the boilerplate prefix when there is no msg field", () => {
    expect(cleanError("An error occurred when processing SDK request: connection refused")).toBe(
      "connection refused",
    )
  })

  test("leaves a plain message untouched", () => {
    expect(cleanError("account and ref are required")).toBe("account and ref are required")
  })
})

describe("cachedResolver", () => {
  test("serves fresh hits from cache, skipping inner", async () => {
    let calls = 0
    let clock = 1000
    const cached = cachedResolver(
      async () => `v${++calls}`,
      30_000,
      () => clock,
    )
    expect(await cached("A", "r")).toBe("v1")
    clock += 10_000
    expect(await cached("A", "r")).toBe("v1") // cached
    expect(calls).toBe(1)
  })

  test("re-resolves after TTL expiry", async () => {
    let calls = 0
    let clock = 0
    const cached = cachedResolver(
      async () => `v${++calls}`,
      30_000,
      () => clock,
    )
    expect(await cached("A", "r")).toBe("v1")
    clock = 30_001
    expect(await cached("A", "r")).toBe("v2")
  })

  test("account and ref are part of the key", async () => {
    let calls = 0
    const cached = cachedResolver(async (a, r) => `${a}:${r}:${++calls}`)
    expect(await cached("A", "r")).toBe("A:r:1")
    expect(await cached("B", "r")).toBe("B:r:2")
    expect(await cached("A", "r2")).toBe("A:r2:3")
  })

  test("failures are not cached", async () => {
    let calls = 0
    const cached = cachedResolver(async () => {
      calls++
      if (calls === 1) throw new Error("boom")
      return "ok"
    })
    await expect(cached("A", "r")).rejects.toThrow("boom")
    expect(await cached("A", "r")).toBe("ok") // retried, not a cached error
  })
})
