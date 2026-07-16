// @ts-ignore
import { describe, expect, test } from "bun:test"
import type { Context } from "@voleeo/plugin-api"
import type {
  AuthConfig,
  GrpcRequest,
  ProtoSource,
  RequestParameter,
} from "@voleeo/types/bindings"
import { serializeAsGrpcurl } from "./serialize"

const ctx = {
  templates: { render: async <T>(v: T) => v },
} as unknown as Context

interface Partial {
  target?: string
  tls?: boolean
  protoSource?: ProtoSource
  service?: string | null
  method?: string | null
  metadata?: RequestParameter[]
  message?: string
  auth?: AuthConfig
}

function mkRequest(p: Partial = {}): GrpcRequest {
  return {
    id: "g1",
    type: "grpc",
    model: "grpc",
    workspaceId: "w1",
    folderId: null,
    name: "Test",
    target: p.target ?? "localhost:50051",
    tls: p.tls ?? false,
    protoSource: p.protoSource ?? { kind: "reflection" },
    service: p.service ?? "helloworld.Greeter",
    method: p.method ?? "SayHello",
    metadata: p.metadata,
    message: p.message ?? '{"name":"world"}',
    auth: p.auth ?? { kind: "none" },
    order: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  } as GrpcRequest
}

const param = (
  name: string,
  value: string,
  enabled = true,
): RequestParameter => ({ id: `p_${name}`, name, value, enabled })

describe("serializeAsGrpcurl — basics", () => {
  test("plaintext + reflection + body", async () => {
    const out = await serializeAsGrpcurl(mkRequest(), ctx)
    expect(out.startsWith("grpcurl \\")).toBe(true)
    expect(out).toContain("-plaintext")
    expect(out).not.toContain("-proto")
    expect(out).not.toContain("-import-path")
    expect(out).toContain("-d ")
    expect(out).toContain("'localhost:50051'")
    expect(out).toContain("'helloworld.Greeter/SayHello'")
    expect(out).toContain('"name": "world"')
  })

  test("TLS omits -plaintext", async () => {
    const out = await serializeAsGrpcurl(mkRequest({ tls: true }), ctx)
    expect(out).not.toContain("-plaintext")
  })

  test("files proto source emits import-path and proto", async () => {
    const out = await serializeAsGrpcurl(
      mkRequest({
        protoSource: {
          kind: "files",
          paths: ["example/v1/greeter.proto"],
          include_dirs: ["/path/to/protos"],
        },
      }),
      ctx,
    )
    expect(out).toContain("-import-path '/path/to/protos'")
    expect(out).toContain("-proto 'example/v1/greeter.proto'")
  })

  test("empty message becomes {}", async () => {
    const out = await serializeAsGrpcurl(mkRequest({ message: "  " }), ctx)
    expect(out).toContain("-d '{}'")
  })
})

describe("serializeAsGrpcurl — metadata and auth", () => {
  test("enabled metadata as -H", async () => {
    const out = await serializeAsGrpcurl(
      mkRequest({
        metadata: [
          param("x-request-id", "abc"),
          param("x-skip", "nope", false),
        ],
      }),
      ctx,
    )
    expect(out).toContain("-H 'x-request-id: abc'")
    expect(out).not.toContain("x-skip")
  })

  test("bearer auth as authorization header", async () => {
    const out = await serializeAsGrpcurl(
      mkRequest({
        auth: { kind: "bearer", token: "tok123", enabled: true },
      }),
      ctx,
    )
    expect(out).toContain("-H 'authorization: Bearer tok123'")
  })

  test("basic auth as Base64 authorization", async () => {
    const out = await serializeAsGrpcurl(
      mkRequest({
        auth: {
          kind: "basic",
          username: "user",
          password: "pass",
          enabled: true,
        },
      }),
      ctx,
    )
    expect(out).toContain("-H 'authorization: Basic dXNlcjpwYXNz'")
  })

  test("disabled auth omitted", async () => {
    const out = await serializeAsGrpcurl(
      mkRequest({
        auth: { kind: "bearer", token: "tok", enabled: false },
      }),
      ctx,
    )
    expect(out).not.toContain("authorization")
  })

  test("api_key as metadata header regardless of location", async () => {
    const out = await serializeAsGrpcurl(
      mkRequest({
        auth: {
          kind: "api_key",
          key: "x-api-key",
          value: "secret",
          location: "query",
          enabled: true,
        },
      }),
      ctx,
    )
    expect(out).toContain("-H 'x-api-key: secret'")
  })
})

describe("serializeAsGrpcurl — escaping", () => {
  test("shell-quotes body with single quotes", async () => {
    const out = await serializeAsGrpcurl(
      mkRequest({ message: `{"note":"it's fine"}` }),
      ctx,
    )
    expect(out).toContain("'\\''")
  })
})
