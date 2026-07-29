// @ts-expect-error — bun:test lacks TS types in this workspace
import { describe, expect, test } from "bun:test"
import { parseGrpcurlCommand } from "./grpcurlParser"

describe("parseGrpcurlCommand", () => {
  test("rejects non-grpcurl input", () => {
    expect(parseGrpcurlCommand("curl https://example.com")).toBeNull()
    expect(parseGrpcurlCommand("")).toBeNull()
    // A command with no target has nothing to import.
    expect(parseGrpcurlCommand("grpcurl -plaintext")).toBeNull()
  })

  test("plaintext, reflection, target and symbol", () => {
    const p = parseGrpcurlCommand(
      "grpcurl -plaintext localhost:50051 helloworld.Greeter/SayHello",
    )
    expect(p?.target).toBe("localhost:50051")
    expect(p?.tls).toBe(false)
    expect(p?.protoSource).toEqual({ kind: "reflection" })
    expect(p?.service).toBe("helloworld.Greeter")
    expect(p?.method).toBe("SayHello")
  })

  test("TLS is the default when -plaintext is absent", () => {
    expect(parseGrpcurlCommand("grpcurl api.example.com:443 S/M")?.tls).toBe(
      true,
    )
  })

  test("dotted symbol splits on the last dot", () => {
    const p = parseGrpcurlCommand("grpcurl localhost:1 helloworld.Greeter.Say")
    expect(p?.service).toBe("helloworld.Greeter")
    expect(p?.method).toBe("Say")
  })

  test("list and describe carry no method", () => {
    expect(parseGrpcurlCommand("grpcurl localhost:1 list")?.method).toBeNull()
    expect(
      parseGrpcurlCommand("grpcurl localhost:1 describe")?.service,
    ).toBeNull()
  })

  test("proto files and import paths", () => {
    const p = parseGrpcurlCommand(
      "grpcurl -import-path /protos -proto a.proto -proto b.proto localhost:1 S/M",
    )
    expect(p?.protoSource).toEqual({
      kind: "files",
      paths: ["a.proto", "b.proto"],
      include_dirs: ["/protos"],
    })
  })

  test("headers become metadata, body becomes the message", () => {
    const p = parseGrpcurlCommand(
      `grpcurl -H 'x-a: 1' -rpc-header 'x-b: 2' -d '{"n":1}' localhost:1 S/M`,
    )
    expect(p?.metadata.map((m) => [m.name, m.value])).toEqual([
      ["x-a", "1"],
      ["x-b", "2"],
    ])
    expect(p?.message).toBe('{"n":1}')
  })

  test("-d @ reads stdin — nothing to import", () => {
    expect(parseGrpcurlCommand("grpcurl -d @ localhost:1 S/M")?.message).toBe(
      "",
    )
  })

  test("-flag=value form", () => {
    const p = parseGrpcurlCommand(
      "grpcurl -d={} -H=x-a:1 -max-time=30 localhost:1 S/M",
    )
    expect(p?.message).toBe("{}")
    expect(p?.metadata[0]?.name).toBe("x-a")
    expect(p?.target).toBe("localhost:1")
  })

  test("skipped value flags don't swallow the target", () => {
    const p = parseGrpcurlCommand(
      "grpcurl -plaintext -max-time 30 -authority foo localhost:1 S/M",
    )
    expect(p?.target).toBe("localhost:1")
    expect(p?.method).toBe("M")
  })

  test("an unknown flag is treated as boolean, not as eating the target", () => {
    const p = parseGrpcurlCommand("grpcurl -future-flag localhost:1 S/M")
    expect(p?.target).toBe("localhost:1")
    expect(p?.method).toBe("M")
  })

  // The round trip that matters: what "Copy as grpcurl" writes to the clipboard
  // must parse back into the request it came from — multi-line continuations,
  // single-quoted body and all.
  test("parses the multi-line output of Copy as grpcurl", () => {
    const copied = [
      "grpcurl \\",
      "  -plaintext \\",
      "  -H 'authorization: Bearer tok' \\",
      `  -d '{`,
      `  "name": "it'\\''s fine"`,
      `}' \\`,
      "  'localhost:50051' 'helloworld.Greeter/SayHello'",
    ].join("\n")

    const p = parseGrpcurlCommand(copied)
    expect(p?.target).toBe("localhost:50051")
    expect(p?.tls).toBe(false)
    expect(p?.service).toBe("helloworld.Greeter")
    expect(p?.method).toBe("SayHello")
    expect(p?.metadata[0]?.value).toBe("Bearer tok")
    expect(JSON.parse(p?.message ?? "")).toEqual({ name: "it's fine" })
  })
})
