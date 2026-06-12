import type { GraphQLNamedType, GraphQLSchema } from "graphql"
import { Fragment, useMemo, useState } from "react"
import { Glyph } from "@/components/Glyph"
import { cn } from "@/lib/utils"
import { namedTypeList, TypeRow } from "./schemaUtils"
import { TypeView } from "./TypeView"

interface Props {
  schema: GraphQLSchema
  onClose: () => void
}

export function GraphqlDocs({ schema, onClose }: Props) {
  const [stack, setStack] = useState<string[]>([])
  const [search, setSearch] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  const toggleSearch = () => {
    setSearchOpen((v) => {
      if (v) setSearch("")
      return !v
    })
  }

  const current = stack[stack.length - 1]
  const navigate = (name: string) => {
    setSearch("")
    setStack((s) => [...s, name])
  }
  const goTo = (depth: number) => {
    setSearch("")
    setStack((s) => s.slice(0, depth))
  }

  const rootTypes = useMemo(() => {
    const roots: {
      label: string
      type: GraphQLNamedType | null | undefined
    }[] = [
      { label: "Query", type: schema.getQueryType() },
      { label: "Mutation", type: schema.getMutationType() },
      { label: "Subscription", type: schema.getSubscriptionType() },
    ]
    return roots.filter((r) => r.type)
  }, [schema])

  const allTypes = useMemo(() => namedTypeList(schema), [schema])
  const otherTypes = useMemo(() => {
    const rootNames = new Set(rootTypes.map((r) => r.type?.name))
    return allTypes.filter((t) => !rootNames.has(t.name))
  }, [allTypes, rootTypes])

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return null
    return allTypes.filter((t) => t.name.toLowerCase().includes(q))
  }, [search, allTypes])

  return (
    <div className="h-full flex flex-col bg-bg">
      <div className="shrink-0 flex items-center gap-2 px-3 h-10 border-b border-border">
        <div className="flex items-center gap-1 min-w-0 overflow-hidden text-[0.85rem]">
          <Glyph kind="book" size={15} color="var(--base04)" />
          <button
            type="button"
            onClick={() => goTo(0)}
            className={cn(
              "shrink-0 bg-transparent border-0 cursor-pointer",
              stack.length === 0
                ? "text-fg font-semibold"
                : "text-muted hover:text-accent",
            )}
          >
            Schema
          </button>
          {stack.map((name, i) => (
            <Fragment key={stack.slice(0, i + 1).join(">")}>
              <Glyph kind="chevron" size={11} color="var(--base04)" />
              <button
                type="button"
                onClick={() => goTo(i + 1)}
                className={cn(
                  "min-w-0 truncate bg-transparent border-0 cursor-pointer",
                  i === stack.length - 1
                    ? "text-fg font-semibold shrink-0"
                    : "text-muted hover:text-accent",
                )}
              >
                {name}
              </button>
            </Fragment>
          ))}
        </div>
        <div className="ml-auto shrink-0 flex items-center gap-1">
          <button
            type="button"
            onClick={toggleSearch}
            title="Search the schema"
            aria-label="Search the schema"
            className={cn(
              "p-1 rounded-[3px] bg-transparent border-0 cursor-pointer transition-colors",
              searchOpen ? "text-accent" : "text-muted hover:text-fg",
            )}
          >
            <Glyph kind="search" size={14} color="currentColor" />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close docs"
            aria-label="Close docs"
            className="p-1 rounded-[3px] text-muted hover:text-fg bg-transparent border-0 cursor-pointer transition-colors"
          >
            <Glyph kind="x" size={14} color="currentColor" />
          </button>
        </div>
      </div>

      {searchOpen && (
        <div className="shrink-0 px-3 py-2 border-b border-border">
          <div className="flex items-center gap-2 px-2 h-8 rounded-[5px] border border-border bg-surface">
            <Glyph kind="search" size={13} color="var(--base04)" />
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => {
                if (!search.trim()) setSearchOpen(false)
              }}
              placeholder="Search the schema…"
              spellCheck={false}
              className="w-full bg-transparent outline-none font-mono text-[0.8rem] text-fg placeholder:text-muted/50"
            />
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
        {searchResults ? (
          searchResults.length === 0 ? (
            <p className="px-1 py-2 text-[0.8rem] text-muted">No matches.</p>
          ) : (
            searchResults.map((t) => (
              <TypeRow key={t.name} type={t} onNavigate={navigate} />
            ))
          )
        ) : current ? (
          <TypeView schema={schema} name={current} onNavigate={navigate} />
        ) : (
          <>
            <p className="px-1 mb-1 text-[0.78rem] text-muted leading-relaxed">
              A GraphQL schema provides a root type for each kind of operation.
              Pick a type to explore its fields.
            </p>
            <div className="mt-2 mb-1 px-1 font-mono text-[0.65rem] uppercase tracking-wider text-muted">
              Root types
            </div>
            {rootTypes.map(
              (r) =>
                r.type && (
                  <TypeRow key={r.label} type={r.type} onNavigate={navigate} />
                ),
            )}
            <div className="flex items-center justify-between mt-3 mb-1 px-1">
              <span className="font-mono text-[0.65rem] uppercase tracking-wider text-muted">
                Types
              </span>
              <span className="font-mono text-[0.65rem] text-muted">
                {otherTypes.length}
              </span>
            </div>
            {otherTypes.map((t) => (
              <TypeRow key={t.name} type={t} onNavigate={navigate} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
