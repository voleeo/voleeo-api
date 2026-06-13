// @ts-expect-error — bun:test lacks TS types in this workspace
import { describe, expect, it } from "bun:test"
import {
  AUTH_SCHEMES,
  type AuthKind,
  freshAuth,
  isDynamicScheme,
  SELECTABLE_AUTH_KINDS,
  schemeSupports,
} from "./authSchemes"

describe("authSchemes", () => {
  it("fresh config carries the matching kind", () => {
    for (const kind of Object.keys(AUTH_SCHEMES) as AuthKind[]) {
      expect(freshAuth(kind).kind).toBe(kind)
    }
  })

  it("every scheme has a non-empty label and at least one protocol", () => {
    for (const scheme of Object.values(AUTH_SCHEMES)) {
      expect(scheme.label.length).toBeGreaterThan(0)
      expect(scheme.protocols.length).toBeGreaterThan(0)
    }
  })

  it("AWS SigV4 is dynamic and HTTP-only", () => {
    expect(isDynamicScheme("aws_sig_v4")).toBe(true)
    expect(schemeSupports("aws_sig_v4", "http")).toBe(true)
    expect(schemeSupports("aws_sig_v4", "ws")).toBe(false)
    expect(schemeSupports("aws_sig_v4", "grpc")).toBe(false)
  })

  it("static schemes apply to every protocol and are not dynamic", () => {
    for (const kind of ["bearer", "basic", "api_key"] as AuthKind[]) {
      expect(isDynamicScheme(kind)).toBe(false)
      expect(schemeSupports(kind, "http")).toBe(true)
      expect(schemeSupports(kind, "ws")).toBe(true)
      expect(schemeSupports(kind, "grpc")).toBe(true)
    }
  })

  it("fresh AWS SigV4 has empty credential fields", () => {
    const cfg = freshAuth("aws_sig_v4")
    if (cfg.kind !== "aws_sig_v4") throw new Error("wrong kind")
    expect(cfg.access_key).toBe("")
    expect(cfg.region).toBe("")
    expect(cfg.service).toBe("")
  })

  it("selectable kinds exclude inherit (appended separately)", () => {
    expect(SELECTABLE_AUTH_KINDS).not.toContain("inherit")
    expect(SELECTABLE_AUTH_KINDS[0]).toBe("none")
  })
})
