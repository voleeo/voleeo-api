import { isAbortError } from "@/lib/abort"
import type { BoundTemplateFunction } from "@/plugins/types"
import type { EnvironmentVariable } from "@/store/environment"
import { serialize, tokenize } from "./templateTokens"

export interface ResolutionEvent {
  label: string
  source: string
  result: string
}

export interface ResolutionLog {
  events: ResolutionEvent[]
  label: string
}

/** Resolve `{{ … }}` tokens in `text`. The `fns` are the registry-bound
 * variants: each function already carries its owning plugin's `Context`,
 * so the resolver just passes `args`. */
export async function resolveTemplate(
  text: string,
  vars: EnvironmentVariable[],
  fns: BoundTemplateFunction[],
  log?: ResolutionLog,
): Promise<string> {
  return resolveTemplateImpl(text, vars, fns, new Set(), log)
}

async function resolveTemplateImpl(
  text: string,
  vars: EnvironmentVariable[],
  fns: BoundTemplateFunction[],
  visited: ReadonlySet<string>,
  log?: ResolutionLog,
): Promise<string> {
  const tokens = tokenize(text)
  const parts = await Promise.all(
    tokens.map(async (tok) => {
      if (tok.kind === "plain") return tok.text

      const source = serialize([tok])

      if (tok.kind === "var") {
        if (visited.has(tok.name)) return source // cycle guard
        const found = vars.find((v) => v.key === tok.name && v.enabled)
        if (!found) {
          // Surface "missing variable" as a resolution event too — that's a
          // common debugging pain point.
          if (log) {
            log.events.push({
              label: log.label,
              source,
              result: "(undefined)",
            })
          }
          return source
        }
        // Transitively resolve: ENV1={{ VAR }}, VAR=111 → ENV1=111.
        // Each recursive call gets a new Set so sibling tokens don't share state.
        const result = found.value.includes("{{")
          ? await resolveTemplateImpl(
              found.value,
              vars,
              fns,
              new Set([...visited, tok.name]),
              log,
            )
          : found.value
        if (log) log.events.push({ label: log.label, source, result })
        return result
      }

      // func
      const fn = fns.find((f) => f.name === tok.name)
      if (!fn) {
        if (log) {
          log.events.push({
            label: log.label,
            source,
            result: "(unknown function)",
          })
        }
        return source
      }
      try {
        const result = (await fn.onRender(tok.args)) ?? ""
        if (log) log.events.push({ label: log.label, source, result })
        return result
      } catch (e) {
        if (isAbortError(e)) throw e
        if (log) {
          log.events.push({
            label: log.label,
            source,
            result: `(error: ${e instanceof Error ? e.message : String(e)})`,
          })
        }
        return source
      }
    }),
  )
  return parts.join("")
}
