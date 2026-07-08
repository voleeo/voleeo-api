import type { CookieJar } from "@/store/cookies"
import {
  commands,
  type StoredCookie_Deserialize,
} from "../../../../../../packages/types/bindings"
import { type ResolveCtx, resolve } from "./context"

export async function resolveCookies(
  ctx: ResolveCtx,
  activeJar: CookieJar | null | undefined,
  workspaceId: string,
): Promise<StoredCookie_Deserialize[] | null> {
  if (!activeJar) return null

  // The encrypt plugin keeps `enc:v1:` ciphertext through resolution; decrypt it
  // here so the Timing tab and the wire show the actual plaintext.
  const resolveAndDecrypt = async (raw: string, label: string) => {
    const before = ctx.log.events.length
    const resolved = await resolve(ctx, raw, label)
    const plain = await decryptInline(resolved, workspaceId)
    if (plain !== resolved) {
      for (let i = before; i < ctx.log.events.length; i++) {
        const ev = ctx.log.events[i]
        if (ev.result.includes("enc:v1:")) {
          ev.result = await decryptInline(ev.result, workspaceId)
        }
      }
    }
    return plain
  }
  return Promise.all(
    activeJar.cookies.map(async (c) => ({
      ...c,
      value: await resolveAndDecrypt(c.value, `Cookie "${c.name}" value`),
      domain: await resolveAndDecrypt(c.domain, `Cookie "${c.name}" domain`),
      path: await resolveAndDecrypt(c.path, `Cookie "${c.name}" path`),
    })),
  )
}

/** Replace each `enc:v1:<hex>` with its plaintext; on failure leave it in place
 *  (visible breakage beats a silent empty). */
async function decryptInline(
  text: string,
  workspaceId: string,
): Promise<string> {
  if (!text.includes("enc:v1:")) return text
  const re = /enc:v1:[0-9A-Fa-f]+/g
  const blobs = Array.from(new Set(text.match(re) ?? []))
  if (blobs.length === 0) return text
  const map = new Map<string, string>()
  for (const blob of blobs) {
    const res = await commands.workspaceDecryptValue(workspaceId, blob)
    map.set(blob, res.status === "ok" ? res.data : blob)
  }
  return text.replace(re, (m) => map.get(m) ?? m)
}
