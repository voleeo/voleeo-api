import { json as jsonLang } from "@codemirror/lang-json"
import { xml as xmlLang } from "@codemirror/lang-xml"
import { search } from "@codemirror/search"
import CodeMirror, {
  defaultLightThemeOption,
  EditorView,
  keymap,
  oneDark,
} from "@uiw/react-codemirror"
import { useEffect, useMemo, useRef } from "react"
import { Glyph } from "@/components/Glyph"
import { cn } from "@/lib/utils"
import { useInterfaceStore } from "@/store/interface"
import { useThemeStore } from "@/store/theme"
import { cmEditorTheme } from "../cmEditorTheme"
import { foldingExtension } from "../cmFolding"
import type { BodyLang } from "./bodyLang"
import { FindBar } from "./FindBar"
import { useBodyFilter } from "./useBodyFilter"
import { useCmFind } from "./useCmFind"
import type { CodeTools } from "./useCodeTools"

export function CodeBody({
  rawText,
  lang,
  tools,
}: {
  rawText: string
  lang: BodyLang
  tools: CodeTools
}) {
  const activeTheme = useThemeStore((s) => s.activeTheme)
  const isDark = activeTheme?.kind !== "light"
  const wrap = useInterfaceStore((s) => s.wrapResponse)
  const setWrap = useInterfaceStore((s) => s.setWrapResponse)
  const { findOpen, filterOpen, closeFilter } = tools

  const { filterQuery, setFilterQuery, filterInputRef, filterResult } =
    useBodyFilter({ rawText, lang, open: filterOpen })

  const cmViewRef = useRef<EditorView | null>(null)
  const find = useCmFind(cmViewRef)
  const openFindRef = useRef<() => void>(() => {})
  openFindRef.current = tools.openFind

  // Clear the CM search when the find bar closes (from the bar's X or the tab-bar toggle).
  useEffect(() => {
    if (!findOpen) find.clear()
  }, [findOpen, find.clear])

  function closeFind() {
    tools.closeFind()
  }

  const langExt = useMemo(() => {
    if (lang === "json") return jsonLang()
    if (lang === "xml") return xmlLang()
    return []
  }, [lang])

  const extensions = useMemo(
    () => [
      isDark ? oneDark : defaultLightThemeOption,
      cmEditorTheme,
      ...(Array.isArray(langExt) ? langExt : [langExt]),
      search(),
      keymap.of([
        {
          key: "Mod-f",
          preventDefault: true,
          run: () => {
            openFindRef.current()
            return true
          },
        },
      ]),
      ...(lang === "json" || lang === "xml" ? [foldingExtension()] : []),
      ...(wrap ? [EditorView.lineWrapping] : []),
    ],
    [isDark, langExt, lang, wrap],
  )

  const placeholder =
    lang === "json"
      ? "$.field  ·  $.items[*].name  ·  $..author"
      : "//tag  ·  /root/items  ·  //item[@id='1']"

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {filterOpen && (
        <div
          className={cn(
            "shrink-0 flex items-center gap-2 px-3 py-1.5 border-b bg-surface",
            filterResult.error ? "border-error/60" : "border-border",
          )}
        >
          <Glyph
            kind="filter"
            size={12}
            color={filterResult.error ? "var(--base08)" : "var(--base04)"}
          />
          <input
            ref={filterInputRef}
            autoFocus
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && closeFilter()}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            className="flex-1 bg-transparent border-none outline-none font-mono text-[0.786rem] text-fg placeholder:text-muted"
          />
          {filterQuery.trim() && (
            <span
              className={cn(
                "font-mono text-[0.714rem] shrink-0",
                filterResult.error ? "text-error" : "text-muted",
              )}
            >
              {filterResult.error
                ? filterResult.error
                : filterResult.matchCount === 0
                  ? "no matches"
                  : filterResult.matchCount !== null
                    ? `${filterResult.matchCount} match${filterResult.matchCount !== 1 ? "es" : ""}`
                    : null}
            </span>
          )}
          <button
            type="button"
            onClick={closeFilter}
            className="flex items-center justify-center w-4 h-4 rounded-[2px] border-0 bg-transparent outline-none cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
          >
            <Glyph kind="x" size={10} color="var(--base04)" />
          </button>
        </div>
      )}

      {findOpen && (
        <FindBar
          query={find.query}
          onChange={find.setQuery}
          onNext={find.next}
          onPrev={find.prev}
          onClose={closeFind}
          status={find.status}
        />
      )}

      <div className="flex-1 min-h-0 relative overflow-hidden">
        {!filterOpen && !findOpen && (
          <div className="absolute top-1.5 right-4 z-10 flex items-center gap-1">
            <button
              type="button"
              title={wrap ? "Disable line wrap" : "Wrap long lines"}
              onClick={() => setWrap(!wrap)}
              className={cn(
                "p-1 rounded-[3px] border bg-transparent cursor-pointer transition-colors",
                wrap
                  ? "border-accent/50 text-accent"
                  : "border-border text-muted hover:text-fg hover:border-fg/30",
              )}
            >
              <Glyph kind="wrap" size={13} color="currentColor" />
            </button>
          </div>
        )}
        <CodeMirror
          value={filterResult.displayText}
          readOnly
          theme="none"
          extensions={extensions}
          onCreateEditor={(view) => {
            cmViewRef.current = view
          }}
          height="100%"
          style={{ height: "100%" }}
          basicSetup={{
            lineNumbers: true,
            foldGutter: false,
            highlightActiveLine: true,
            highlightSelectionMatches: true,
            autocompletion: false,
            searchKeymap: false,
          }}
        />
      </div>
    </div>
  )
}
