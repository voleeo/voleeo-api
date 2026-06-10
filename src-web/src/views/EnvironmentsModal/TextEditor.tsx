import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useShallow } from "zustand/react/shallow"
import { Autocomplete } from "@/components/TemplateInput/Autocomplete"
import { useTemplateFunctions } from "@/plugins/hooks"
import type { Environment, EnvironmentVariable } from "@/store/environment"
import {
  useEnvironmentStore,
  useEnvironmentStore as useEnvStore,
} from "@/store/environment"
import { useTextareaAutocomplete } from "./useTextareaAutocomplete"

function serializeVars(variables: EnvironmentVariable[]): string {
  return variables
    .map((v) => {
      const val = v.encrypted ? `{{ encrypt(value="${v.value}") }}` : v.value
      return `${v.key}=${val}`
    })
    .join("\n")
}

function parse(
  text: string,
  original: EnvironmentVariable[],
): EnvironmentVariable[] {
  const origMap = new Map(original.map((v) => [v.key, v]))
  const result: EnvironmentVariable[] = []
  for (const line of text.split("\n")) {
    const eqIdx = line.indexOf("=")
    if (eqIdx < 1) continue
    const key = line.slice(0, eqIdx).trim()
    const rawVal = line.slice(eqIdx + 1)
    // Match {{ encrypt(value="...") }} — the standard template form for encrypted vars.
    // Note: values containing double-quote characters are not supported in this
    // syntax. Use the grid editor (Variables tab) for secrets with special chars.
    const encryptMatch = rawVal.match(
      /^\{\{\s*encrypt\(value="([^"]*)"\)\s*\}\}$/,
    )
    const encrypted = Boolean(encryptMatch)
    const value = encryptMatch ? encryptMatch[1] : rawVal
    result.push({
      key,
      value,
      encrypted: encrypted || (origMap.get(key)?.encrypted ?? false),
      enabled: origMap.get(key)?.enabled ?? true,
    })
  }
  return result
}

interface Props {
  env: Environment
}

export function TextEditor({ env }: Props) {
  const { update } = useEnvStore()
  const [text, setText] = useState(() => serializeVars(env.variables))

  // Reset when env selection changes.
  const prevEnvIdRef = useRef(env.id)
  if (env.id !== prevEnvIdRef.current) {
    prevEnvIdRef.current = env.id
    // Synchronous state update during render — React re-renders immediately.
    setText(serializeVars(env.variables))
  }

  // Sync text when env is updated externally (e.g. by an MCP client) while
  // the same env is selected. TextEditor saves on blur (not debounced), so
  // there is no pending-write race to guard against.
  useEffect(() => {
    setText(serializeVars(env.variables))
  }, [env.variables])

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { environments, activeEnvId } = useEnvironmentStore(
    useShallow((s) => ({
      environments: s.environments,
      activeEnvId: s.activeEnvId,
    })),
  )
  const activeVars = useMemo(() => {
    const globalVars =
      environments
        .find((e) => e.kind === "global")
        ?.variables.filter((v) => v.enabled) ?? []
    const personalVars =
      environments
        .find((e) => e.id === activeEnvId)
        ?.variables.filter((v) => v.enabled) ?? []
    const personalKeys = new Set(personalVars.map((v) => v.key))
    return [
      ...personalVars,
      ...globalVars.filter((v) => !personalKeys.has(v.key)),
    ]
  }, [environments, activeEnvId])

  const fns = useTemplateFunctions()

  const {
    acOpen,
    acItems,
    acIdx,
    acQuery,
    anchorRect,
    selectItem,
    closeAutocomplete,
    syncFromCaret,
    handleKeyDown,
  } = useTextareaAutocomplete({
    textareaRef,
    varKeys: useMemo(() => activeVars.map((v) => v.key), [activeVars]),
    fns,
    setText,
  })

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    setText(val)
    syncFromCaret(val, e.target.selectionStart ?? val.length)
  }

  async function handleBlur() {
    const parsed = parse(text, env.variables)
    await update({ ...env, variables: parsed }).catch(() => {})
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <span className="font-sans text-[0.857rem] text-muted mb-2">
        One variable per line:{" "}
        <code className="font-mono text-[0.786rem] text-fg/70">KEY=value</code>{" "}
        or{" "}
        <code className="font-mono text-[0.786rem] text-fg/70">
          {'KEY={{ encrypt(value="secret") }}'}
        </code>{" "}
        for encrypted variables (values with{" "}
        <code className="font-mono text-[0.786rem] text-fg/70">"</code> must use
        the Variables tab). Use{" "}
        <code className="font-mono text-[0.786rem] text-fg/70">
          {"{{ expr }}"}
        </code>{" "}
        for template expressions (Ctrl+Space for autocomplete).
      </span>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        spellCheck={false}
        className="flex-1 min-h-[200px] font-mono text-[0.929rem] text-fg bg-bg border border-border rounded-[5px] p-3 outline-none focus:border-accent resize-none select-text leading-relaxed"
        placeholder={
          'API_URL=https://api.example.com\nSECRET_KEY={{ encrypt(value="my-secret") }}'
        }
      />

      {acOpen &&
        anchorRect &&
        acItems.length > 0 &&
        createPortal(
          <Autocomplete
            items={acItems}
            selectedIndex={acIdx}
            anchorRect={anchorRect}
            query={acQuery}
            onSelect={selectItem}
            onClose={closeAutocomplete}
          />,
          document.body,
        )}
    </div>
  )
}
