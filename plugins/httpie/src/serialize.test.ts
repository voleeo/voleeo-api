// @ts-ignore
import { describe, expect, test } from "bun:test"
import type { Context } from "@voleeo/plugin-api"
import type {
  AuthConfig,
  HttpRequest,
  RequestBody,
  RequestParameter,
} from "@voleeo/types/bindings"
import { serializeAsHttpie } from "./serialize"

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

describe("serializeAsHttpie — basics", () => {
  test("minimal GET emits 'http GET <url>' on one line", async () => {
    const out = await serializeAsHttpie(mkRequest(), ctx)
    expect(out).toBe("http GET 'https://api.example.com/users'")
  })

  test("method is always emitted (HTTPie is explicit)", async () => {
    const out = await serializeAsHttpie(mkRequest({ method: "POST" }), ctx)
    expect(out.startsWith("http POST 'https://api.example.com/users'")).toBe(
      true,
    )
  })

  test("method is uppercased", async () => {
    const out = await serializeAsHttpie(mkRequest({ method: "delete" }), ctx)
    expect(out.startsWith("http DELETE")).toBe(true)
  })
})

describe("serializeAsHttpie — params", () => {
  test("query params emit as 'name==value' positional args", async () => {
    const out = await serializeAsHttpie(
      mkRequest({ parameters: [param("a", "1"), param("b", "hi")] }),
      ctx,
    )
    expect(out).toContain("'a==1'")
    expect(out).toContain("'b==hi'")
  })

  test("URL does NOT carry the query string (HTTPie owns it)", async () => {
    const out = await serializeAsHttpie(
      mkRequest({ parameters: [param("a", "1")] }),
      ctx,
    )
    expect(out).toContain("'https://api.example.com/users'")
    expect(out).not.toContain("/users?")
  })

  test("disabled query params are omitted", async () => {
    const out = await serializeAsHttpie(
      mkRequest({ parameters: [param("a", "1", false)] }),
      ctx,
    )
    expect(out).not.toContain("a==1")
  })

  test("path params substitute and URL-encode", async () => {
    const out = await serializeAsHttpie(
      mkRequest({
        url: "https://api.example.com/users/:id",
        parameters: [param("id", "a/b c")],
      }),
      ctx,
    )
    expect(out).toContain("/users/a%2Fb%20c'")
  })
})

describe("serializeAsHttpie — headers", () => {
  test("headers emit as 'Name:value'", async () => {
    const out = await serializeAsHttpie(
      mkRequest({ headers: [param("X-Trace", "abc")] }),
      ctx,
    )
    expect(out).toContain("'X-Trace:abc'")
  })

  test("disabled headers are omitted", async () => {
    const out = await serializeAsHttpie(
      mkRequest({ headers: [param("X-Trace", "abc", false)] }),
      ctx,
    )
    expect(out).not.toContain("X-Trace")
  })
})

describe("serializeAsHttpie — body", () => {
  test("flat JSON: string fields use '=' token", async () => {
    const out = await serializeAsHttpie(
      mkRequest({
        method: "POST",
        body: { kind: "json", text: '{"name":"alex"}' },
      }),
      ctx,
    )
    expect(out).toContain("'name=alex'")
    expect(out).not.toContain("--raw")
  })

  test("flat JSON: non-string fields use ':=' raw-JSON token", async () => {
    const out = await serializeAsHttpie(
      mkRequest({
        method: "POST",
        body: { kind: "json", text: '{"count":42,"flag":true,"x":null}' },
      }),
      ctx,
    )
    expect(out).toContain("'count:=42'")
    expect(out).toContain("'flag:=true'")
    expect(out).toContain("'x:=null'")
  })

  test("nested JSON object falls back to --raw", async () => {
    const out = await serializeAsHttpie(
      mkRequest({
        method: "POST",
        body: { kind: "json", text: '{"nested":{"a":1}}' },
      }),
      ctx,
    )
    expect(out).toContain("--raw")
  })

  test("unparseable JSON body falls back to --raw", async () => {
    const out = await serializeAsHttpie(
      mkRequest({
        method: "POST",
        body: { kind: "json", text: "not json" },
      }),
      ctx,
    )
    expect(out).toContain("--raw 'not json'")
  })

  test("XML body uses --raw + injects Content-Type", async () => {
    const out = await serializeAsHttpie(
      mkRequest({
        method: "POST",
        body: { kind: "xml", text: "<x/>" },
      }),
      ctx,
    )
    expect(out).toContain("'Content-Type:application/xml'")
    expect(out).toContain("--raw '<x/>'")
  })

  test("body kind 'none' emits no body args", async () => {
    const out = await serializeAsHttpie(
      mkRequest({ method: "POST", body: { kind: "none", text: "" } }),
      ctx,
    )
    expect(out).not.toContain("--raw")
    expect(out).not.toMatch(/'[^']+=[^']*'$/)
  })

  test("single quotes escape as '\\''", async () => {
    const out = await serializeAsHttpie(
      mkRequest({
        method: "POST",
        body: { kind: "text", text: "it's fine" },
      }),
      ctx,
    )
    expect(out).toContain(`--raw 'it'\\''s fine'`)
  })
})

describe("serializeAsHttpie — auth", () => {
  test("bearer emits Authorization header (portable across versions)", async () => {
    const out = await serializeAsHttpie(
      mkRequest({ auth: { kind: "bearer", token: "abc123" } }),
      ctx,
    )
    expect(out).toContain("'Authorization:Bearer abc123'")
  })

  test("basic emits -a flag", async () => {
    const out = await serializeAsHttpie(
      mkRequest({
        auth: { kind: "basic", username: "alex", password: "secret" },
      }),
      ctx,
    )
    expect(out).toContain("-a 'alex:secret'")
    expect(out).not.toContain("Authorization")
  })

  test("digest emits -A digest -a", async () => {
    const out = await serializeAsHttpie(
      mkRequest({
        auth: { kind: "digest", username: "alex", password: "secret" },
      }),
      ctx,
    )
    expect(out).toContain("-A digest")
    expect(out).toContain("-a 'alex:secret'")
  })

  test("api_key header emits custom header", async () => {
    const out = await serializeAsHttpie(
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
    expect(out).toContain("'X-Api-Key:k1'")
  })

  test("api_key query emits as positional name==value arg", async () => {
    const out = await serializeAsHttpie(
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
    expect(out).toContain("'api_key==k1'")
  })
})

describe("serializeAsHttpie — multi-line formatting", () => {
  test("first line is 'http METHOD <url>' (no basic-auth case)", async () => {
    const out = await serializeAsHttpie(
      mkRequest({ headers: [param("X-A", "1")] }),
      ctx,
    )
    const firstLine = out.split("\n")[0]
    expect(firstLine).toBe(`http GET 'https://api.example.com/users' \\`)
  })

  test("first line carries -a when basic auth is set", async () => {
    const out = await serializeAsHttpie(
      mkRequest({
        auth: { kind: "basic", username: "u", password: "p" },
        headers: [param("X-A", "1")],
      }),
      ctx,
    )
    const firstLine = out.split("\n")[0]
    expect(firstLine).toBe(
      `http -a 'u:p' GET 'https://api.example.com/users' \\`,
    )
  })

  test("continuation lines indented 2 spaces", async () => {
    const out = await serializeAsHttpie(
      mkRequest({ headers: [param("X-A", "1"), param("X-B", "2")] }),
      ctx,
    )
    const lines = out.split("\n")
    expect(lines[1]).toMatch(/^ {2}'X-/)
  })

  test("no continuations when there are no extra args", async () => {
    const out = await serializeAsHttpie(mkRequest(), ctx)
    expect(out).not.toContain("\\")
  })
})

describe("serializeAsHttpie — disabled rows skip template resolution", () => {
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
    await serializeAsHttpie(
      mkRequest({ parameters: [param("a", "v1", false)] }),
      trackingCtx,
    )
    expect(resolveCalls).toBe(1)
  })
})
