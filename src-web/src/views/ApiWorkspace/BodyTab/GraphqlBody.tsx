import { json as jsonLang } from "@codemirror/lang-json"
import { graphql } from "cm6-graphql"
import { parse, print } from "graphql"
import { useEffect, useMemo } from "react"
import { Glyph } from "@/components/Glyph"
import { cn } from "@/lib/utils"
import { useGraphqlSchemaStore } from "@/store/graphqlSchema"
import { usePaneTabsStore } from "@/store/paneTabs"
import { useRequestStore } from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import { PaneSeparator } from "../PaneSeparator"
import { lintGutter, makeJsonLinter } from "./bodyLinters"
import { GqlBaseEditor } from "./GqlBaseEditor"
import { useVerticalSplit } from "./useVerticalSplit"

interface Props {
  query: string
  onQueryChange: (v: string) => void
  variables: string
  onVariablesChange: (v: string) => void
  onVarClick: (varName: string) => void
}

export function GraphqlBody({
  query,
  onQueryChange,
  variables,
  onVariablesChange,
  onVarClick,
}: Props) {
  const requestId = useRequestStore((s) => s.activeRequestId)
  const workspaceId = useUiStore((s) => s.activeWorkspaceId)
  const requestUrl = useRequestStore(
    (s) => s.requests.find((r) => r.id === s.activeRequestId)?.url ?? "",
  )

  const schema = useGraphqlSchemaStore((s) =>
    requestId ? s.schemas[requestId] : undefined,
  )

  useEffect(() => {
    if (!requestId || !workspaceId) return
    const url = requestUrl.trim()
    if (!url) {
      useGraphqlSchemaStore.getState().clearSchema(requestId)
      return
    }
    const t = setTimeout(() => {
      const s = useGraphqlSchemaStore.getState()
      if (s.loading[requestId]) return
      if (s.schemas[requestId] && s.urls[requestId] === requestUrl) return
      void s.introspect(workspaceId, requestId, requestUrl)
    }, 250)
    return () => clearTimeout(t)
  }, [requestId, workspaceId, requestUrl])

  const queryLang = useMemo(
    () => (schema ? [graphql(schema)] : [graphql()]),
    [schema],
  )
  const variablesLang = useMemo(
    () => [jsonLang(), lintGutter(), makeJsonLinter()],
    [],
  )

  const beautifyQuery = (text: string) => {
    try {
      return print(parse(text))
    } catch {
      return text
    }
  }
  const beautifyVariables = (text: string) => {
    try {
      return JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      return text
    }
  }

  const docsOpen = useUiStore((s) => s.graphqlDocsOpen)
  const setDocsOpen = useUiStore((s) => s.setGraphqlDocsOpen)
  const docsButton = (
    <button
      type="button"
      onClick={() => setDocsOpen(!docsOpen)}
      disabled={!schema}
      title={schema ? "Schema docs" : "No schema loaded"}
      aria-label="Schema docs"
      className={cn(
        "p-1 rounded-[3px] border bg-transparent cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
        docsOpen && schema
          ? "border-accent text-accent"
          : "border-border text-muted hover:text-fg hover:border-fg/30",
      )}
    >
      <Glyph kind="book" size={13} color="currentColor" />
    </button>
  )

  // Split ratio + variables-collapsed are remembered per request.
  const storedSplit = usePaneTabsStore((s) =>
    requestId ? s.graphqlSplits[requestId] : undefined,
  )
  const collapsed = usePaneTabsStore((s) =>
    requestId ? (s.graphqlVarsCollapsed[requestId] ?? false) : false,
  )
  const toggleCollapsed = () => {
    if (requestId)
      usePaneTabsStore.getState().setGraphqlVarsCollapsed(requestId, !collapsed)
  }
  const { containerRef, topPct, onSepDown } = useVerticalSplit({
    value: storedSplit ?? 60,
    onCommit: (pct) => {
      if (requestId) usePaneTabsStore.getState().setGraphqlSplit(requestId, pct)
    },
  })

  return (
    <div ref={containerRef} className="flex flex-col h-full min-h-0">
      <div
        style={collapsed ? undefined : { height: `${topPct}%` }}
        className={cn("min-h-0", collapsed ? "flex-1" : "shrink-0")}
      >
        <GqlBaseEditor
          value={query}
          onChange={onQueryChange}
          langExtensions={queryLang}
          placeholder={"query {\n  \n}"}
          onVarClick={onVarClick}
          beautify={beautifyQuery}
          extraAction={docsButton}
        />
      </div>
      {!collapsed && <PaneSeparator dir="row" onMouseDown={onSepDown} />}
      <div
        className={cn(
          "min-h-0 flex flex-col",
          collapsed ? "shrink-0" : "flex-1",
        )}
      >
        <div className="shrink-0 flex items-center px-3.5 py-1 font-mono text-[0.714rem] text-muted uppercase tracking-wide bg-surface/40 border-t border-border">
          <span>Variables</span>
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? "Show variables" : "Hide variables"}
            aria-label={collapsed ? "Show variables" : "Hide variables"}
            className="ml-auto -mr-1 p-1 rounded-[3px] text-muted hover:text-fg bg-transparent border-0 cursor-pointer transition-colors"
          >
            <span className={cn("block", collapsed && "rotate-180")}>
              <Glyph kind="chevron-down" size={12} color="currentColor" />
            </span>
          </button>
        </div>
        {!collapsed && (
          <div className="flex-1 min-h-0">
            <GqlBaseEditor
              value={variables}
              onChange={onVariablesChange}
              langExtensions={variablesLang}
              placeholder={'{\n  "key": "value"\n}'}
              onVarClick={onVarClick}
              beautify={beautifyVariables}
            />
          </div>
        )}
      </div>
    </div>
  )
}
