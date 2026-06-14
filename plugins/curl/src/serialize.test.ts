// @ts-ignore
import { describe, expect, test } from "bun:test"
import type { Context } from "@voleeo/plugin-api"
import type {
  AuthConfig,
  HttpRequest,
  RequestBody,
  RequestParameter,
} from "@voleeo/types/bindings"
import { serializeAsCurl } from "./serialize"

/** Stub Context: identity template renderer (no env, no fns). Tests for
 *  template resolution belong in the host's resolveTemplate suite. */
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

describe("serializeAsCurl — basics", () => {
  test("minimal GET omits -X", async () => {
    const out = await serializeAsCurl(mkRequest(), ctx)
    expect(out).toBe("curl 'https://api.example.com/users'")
  })

  test("POST emits -X POST", async () => {
    const out = await serializeAsCurl(mkRequest({ method: "POST" }), ctx)
    expect(out).toBe("curl -X POST 'https://api.example.com/users'")
  })

  test("uppercases method", async () => {
    const out = await serializeAsCurl(mkRequest({ method: "delete" }), ctx)
    expect(out.startsWith("curl -X DELETE")).toBe(true)
  })

  test("GET with body emits -X GET so parsers don't infer POST", async () => {
    const out = await serializeAsCurl(
      mkRequest({
        method: "GET",
        body: { kind: "json", text: '{"a":1}' } as RequestBody,
      }),
      ctx,
    )
    expect(out).toContain("-X GET")
  })
})

describe("serializeAsCurl — params", () => {
  test("query params append as ?a=1&b=2 with URL-encoding", async () => {
    const out = await serializeAsCurl(
      mkRequest({
        parameters: [param("a", "1"), param("b", "hello world")],
      }),
      ctx,
    )
    expect(out).toContain("'https://api.example.com/users?a=1&b=hello%20world'")
  })

  test("disabled query params are omitted", async () => {
    const out = await serializeAsCurl(
      mkRequest({
        parameters: [param("a", "1"), param("b", "2", false)],
      }),
      ctx,
    )
    expect(out).toContain("?a=1'")
    expect(out).not.toContain("b=2")
  })

  test("path params substitute and encode", async () => {
    const out = await serializeAsCurl(
      mkRequest({
        url: "https://api.example.com/users/:id",
        parameters: [param("id", "a/b c")],
      }),
      ctx,
    )
    expect(out).toContain("/users/a%2Fb%20c'")
  })

  test("disabled path params resolve to empty string", async () => {
    const out = await serializeAsCurl(
      mkRequest({
        url: "https://api.example.com/users/:id",
        parameters: [param("id", "42", false)],
      }),
      ctx,
    )
    expect(out).toContain("/users/'")
  })
})

describe("serializeAsCurl — headers", () => {
  test("headers emit -H 'Name: value' lines", async () => {
    const out = await serializeAsCurl(
      mkRequest({ headers: [param("X-Trace", "abc")] }),
      ctx,
    )
    expect(out).toContain("-H 'X-Trace: abc'")
  })

  test("disabled headers are omitted", async () => {
    const out = await serializeAsCurl(
      mkRequest({ headers: [param("X-Trace", "abc", false)] }),
      ctx,
    )
    expect(out).not.toContain("X-Trace")
  })
})

describe("serializeAsCurl — body", () => {
  test("JSON body emits --data-raw + injects Content-Type", async () => {
    const out = await serializeAsCurl(
      mkRequest({
        method: "POST",
        body: { kind: "json", text: '{"name":"alex"}' },
      }),
      ctx,
    )
    expect(out).toContain("-H 'Content-Type: application/json'")
    expect(out).toContain(`--data-raw '{"name":"alex"}'`)
  })

  test("XML body uses application/xml", async () => {
    const out = await serializeAsCurl(
      mkRequest({
        method: "POST",
        body: { kind: "xml", text: "<x/>" },
      }),
      ctx,
    )
    expect(out).toContain("-H 'Content-Type: application/xml'")
  })

  test("text body uses text/plain", async () => {
    const out = await serializeAsCurl(
      mkRequest({
        method: "POST",
        body: { kind: "text", text: "hello" },
      }),
      ctx,
    )
    expect(out).toContain("-H 'Content-Type: text/plain'")
  })

  test("body kind 'none' emits no --data-raw", async () => {
    const out = await serializeAsCurl(
      mkRequest({ method: "POST", body: { kind: "none", text: "" } }),
      ctx,
    )
    expect(out).not.toContain("--data-raw")
  })

  test("user Content-Type wins over auto-injected one", async () => {
    const out = await serializeAsCurl(
      mkRequest({
        method: "POST",
        headers: [param("Content-Type", "application/vnd.foo+json")],
        body: { kind: "json", text: "{}" },
      }),
      ctx,
    )
    expect(out).toContain("application/vnd.foo+json")
    expect(out).not.toContain("Content-Type: application/json")
  })

  test("single quotes in body escape as '\\''", async () => {
    const out = await serializeAsCurl(
      mkRequest({
        method: "POST",
        body: { kind: "text", text: "it's fine" },
      }),
      ctx,
    )
    expect(out).toContain(`--data-raw 'it'\\''s fine'`)
  })
})

describe("serializeAsCurl — auth", () => {
  test("bearer emits Authorization header", async () => {
    const out = await serializeAsCurl(
      mkRequest({ auth: { kind: "bearer", token: "abc123" } }),
      ctx,
    )
    expect(out).toContain("-H 'Authorization: Bearer abc123'")
  })

  test("basic emits -u flag, not header", async () => {
    const out = await serializeAsCurl(
      mkRequest({
        auth: { kind: "basic", username: "alex", password: "secret" },
      }),
      ctx,
    )
    expect(out).toContain("-u 'alex:secret'")
    expect(out).not.toContain("Authorization")
  })

  test("digest emits --digest -u, not a header", async () => {
    const out = await serializeAsCurl(
      mkRequest({
        auth: { kind: "digest", username: "alex", password: "secret" },
      }),
      ctx,
    )
    expect(out).toContain("--digest")
    expect(out).toContain("-u 'alex:secret'")
    expect(out).not.toContain("Authorization")
  })

  test("ntlm emits --ntlm with DOMAIN\\user", async () => {
    const out = await serializeAsCurl(
      mkRequest({
        auth: {
          kind: "ntlm",
          username: "alex",
          password: "secret",
          domain: "CORP",
        },
      }),
      ctx,
    )
    expect(out).toContain("--ntlm")
    expect(out).toContain("-u 'CORP\\alex:secret'")
  })

  test("api_key with location=header emits custom header", async () => {
    const out = await serializeAsCurl(
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
    expect(out).toContain("-H 'X-Api-Key: k1'")
  })

  test("api_key with location=query merges into URL", async () => {
    const out = await serializeAsCurl(
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
    expect(out).toContain("?api_key=k1'")
  })

  test("api_key query coexists with regular query params", async () => {
    const out = await serializeAsCurl(
      mkRequest({
        parameters: [param("a", "1")],
        auth: {
          kind: "api_key",
          key: "api_key",
          value: "k1",
          location: "query",
        },
      }),
      ctx,
    )
    expect(out).toContain("?a=1&api_key=k1")
  })
})

describe("serializeAsCurl — multi-line formatting", () => {
  test("first line carries curl + method + URL", async () => {
    const out = await serializeAsCurl(
      mkRequest({
        method: "POST",
        headers: [param("X-A", "1")],
        body: { kind: "json", text: "{}" },
      }),
      ctx,
    )
    const firstLine = out.split("\n")[0]
    expect(firstLine).toBe(`curl -X POST 'https://api.example.com/users' \\`)
  })

  test("continuation lines indented 2 spaces", async () => {
    const out = await serializeAsCurl(
      mkRequest({ headers: [param("X-A", "1"), param("X-B", "2")] }),
      ctx,
    )
    const lines = out.split("\n")
    expect(lines[1]).toMatch(/^ {2}-H /)
  })
})

describe("serializeAsCurl — disabled rows skip template resolution", () => {
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
    await serializeAsCurl(
      mkRequest({ parameters: [param("a", "v1", false)] }),
      trackingCtx,
    )
    // Only the URL is resolved; the disabled param's name and value are not.
    expect(resolveCalls).toBe(1)
  })
})
