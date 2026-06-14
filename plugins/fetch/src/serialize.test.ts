// @ts-ignore
import { describe, expect, test } from "bun:test"
import type { Context } from "@voleeo/plugin-api"
import type {
  AuthConfig,
  HttpRequest,
  RequestBody,
  RequestParameter,
} from "@voleeo/types/bindings"
import { serializeAsFetch } from "./serialize"

const ctx = {
  templates: { render: async <T>(v: T) => v },
} as unknown as Context

interface Partial {
  method?: string
  url?: string
  parameters?: RequestParameter[]
  headers?: RequestParameter[]
  body?: RequestBody | null
  auth?: AuthConfig
}

function mkRequest(p: Partial = {}): HttpRequest {
  return {
    id: "r1",
    type: "http",
    model: "rest",
    workspaceId: "w1",
    folderId: null,
    method: p.method ?? "GET",
    name: "Test",
    url: p.url ?? "https://api.example.com/users",
    parameters: p.parameters,
    headers: p.headers,
    body: p.body ?? null,
    auth: p.auth ?? { kind: "none" },
    order: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  } as HttpRequest
}

const param = (
  name: string,
  value: string,
  enabled = true,
): RequestParameter => ({ id: `p_${name}`, name, value, enabled })

describe("serializeAsFetch — basics", () => {
  test("minimal GET emits const url + fetch + json", async () => {
    const out = await serializeAsFetch(mkRequest(), ctx)
    expect(out).toContain(`const url = "https://api.example.com/users"`)
    expect(out).toContain("const response = await fetch(url, {")
    expect(out).toContain(`method: "GET"`)
    expect(out).toContain("const data = await response.json()")
  })

  test("method is always emitted (no fetch default)", async () => {
    const out = await serializeAsFetch(mkRequest({ method: "POST" }), ctx)
    expect(out).toContain(`method: "POST"`)
  })

  test("method is uppercased", async () => {
    const out = await serializeAsFetch(mkRequest({ method: "delete" }), ctx)
    expect(out).toContain(`method: "DELETE"`)
  })
})

describe("serializeAsFetch — URL", () => {
  test("path params URL-encode special chars", async () => {
    const out = await serializeAsFetch(
      mkRequest({
        url: "https://api.example.com/users/:id",
        parameters: [param("id", "a/b c")],
      }),
      ctx,
    )
    expect(out).toContain(`const url = "https://api.example.com/users/a%2Fb%20c"`)
  })

  test("query params append URL-encoded", async () => {
    const out = await serializeAsFetch(
      mkRequest({
        parameters: [param("a", "1"), param("b", "hello world")],
      }),
      ctx,
    )
    expect(out).toContain(`"https://api.example.com/users?a=1&b=hello%20world"`)
  })

  test("disabled query params are omitted", async () => {
    const out = await serializeAsFetch(
      mkRequest({
        parameters: [param("a", "1"), param("b", "2", false)],
      }),
      ctx,
    )
    expect(out).not.toContain("b=2")
  })
})

describe("serializeAsFetch — headers", () => {
  test("headers object literal preserves names/values via JSON.stringify", async () => {
    const out = await serializeAsFetch(
      mkRequest({ headers: [param("X-Trace", "abc")] }),
      ctx,
    )
    expect(out).toContain(`"X-Trace": "abc"`)
  })

  test("disabled headers are omitted", async () => {
    const out = await serializeAsFetch(
      mkRequest({ headers: [param("X-Trace", "abc", false)] }),
      ctx,
    )
    expect(out).not.toContain("X-Trace")
  })

  test("no headers block when no headers and no auth", async () => {
    const out = await serializeAsFetch(mkRequest(), ctx)
    expect(out).not.toContain("headers:")
  })
})

describe("serializeAsFetch — body", () => {
  test("flat JSON body emits JSON.stringify(<parsed>)", async () => {
    const out = await serializeAsFetch(
      mkRequest({
        method: "POST",
        body: { kind: "json", text: '{"name":"alex","age":30}' },
      }),
      ctx,
    )
    expect(out).toContain("body: JSON.stringify({")
    expect(out).toContain(`"name": "alex"`)
    expect(out).toContain(`"age": 30`)
  })

  test("unparseable JSON body falls back to raw string", async () => {
    const out = await serializeAsFetch(
      mkRequest({
        method: "POST",
        body: { kind: "json", text: "not json" },
      }),
      ctx,
    )
    expect(out).toContain(`body: "not json"`)
  })

  test("XML body emits as quoted string + injects Content-Type", async () => {
    const out = await serializeAsFetch(
      mkRequest({
        method: "POST",
        body: { kind: "xml", text: "<x/>" },
      }),
      ctx,
    )
    expect(out).toContain(`"Content-Type": "application/xml"`)
    expect(out).toContain(`body: "<x/>"`)
  })

  test("body with quotes is JSON-escaped safely", async () => {
    const out = await serializeAsFetch(
      mkRequest({
        method: "POST",
        body: { kind: "text", text: `it's "great"` },
      }),
      ctx,
    )
    expect(out).toContain(`body: "it's \\"great\\""`)
  })

  test("body kind 'none' emits no body field", async () => {
    const out = await serializeAsFetch(
      mkRequest({ method: "POST", body: { kind: "none", text: "" } }),
      ctx,
    )
    expect(out).not.toContain("body:")
  })
})

describe("serializeAsFetch — auth", () => {
  test("bearer emits Authorization header", async () => {
    const out = await serializeAsFetch(
      mkRequest({ auth: { kind: "bearer", token: "abc123" } }),
      ctx,
    )
    expect(out).toContain(`"Authorization": "Bearer abc123"`)
  })

  test("basic emits btoa() expression with credentials", async () => {
    const out = await serializeAsFetch(
      mkRequest({
        auth: { kind: "basic", username: "alex", password: "secret" },
      }),
      ctx,
    )
    expect(out).toContain(`"Authorization": "Basic " + btoa("alex:secret")`)
  })

  test("digest emits an explanatory comment, no auth header", async () => {
    const out = await serializeAsFetch(
      mkRequest({
        auth: { kind: "digest", username: "alex", password: "secret" },
      }),
      ctx,
    )
    expect(out).toContain("// Digest auth omitted")
    expect(out).not.toContain("secret")
  })

  test("api_key header emits custom header", async () => {
    const out = await serializeAsFetch(
      mkRequest({
        auth: {
          kind: "api_key",
          key: "X-Api-Key",
          value: "k1",
          location: "header",
        },
      }),
      ctx,
    )
    expect(out).toContain(`"X-Api-Key": "k1"`)
  })

  test("api_key query merges into URL", async () => {
    const out = await serializeAsFetch(
      mkRequest({
        auth: {
          kind: "api_key",
          key: "api_key",
          value: "k1",
          location: "query",
        },
      }),
      ctx,
    )
    expect(out).toContain(`?api_key=k1"`)
  })
})

describe("serializeAsFetch — disabled rows skip template resolution", () => {
  test("ctx.templates.render is not called for disabled params", async () => {
    let resolveCalls = 0
    const trackingCtx = {
      templates: {
        render: async <T>(v: T) => {
          resolveCalls++
          return v
        },
      },
    } as unknown as Context
    await serializeAsFetch(
      mkRequest({ parameters: [param("a", "v1", false)] }),
      trackingCtx,
    )
    expect(resolveCalls).toBe(1)
  })
})
