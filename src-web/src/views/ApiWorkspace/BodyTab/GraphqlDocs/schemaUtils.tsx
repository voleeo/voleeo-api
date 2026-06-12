import {
  type GraphQLNamedType,
  type GraphQLSchema,
  type GraphQLType,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isUnionType,
} from "graphql"

/** Single-letter badge + base16 color for a named type's kind. */
export function typeBadge(t: GraphQLNamedType): {
  letter: string
  color: string
} {
  if (isObjectType(t)) return { letter: "T", color: "var(--base0D)" }
  if (isInterfaceType(t)) return { letter: "F", color: "var(--base0F)" }
  if (isUnionType(t)) return { letter: "U", color: "var(--base0E)" }
  if (isEnumType(t)) return { letter: "E", color: "var(--base0A)" }
  if (isInputObjectType(t)) return { letter: "I", color: "var(--base09)" }
  return { letter: "S", color: "var(--base0C)" } // scalar
}

export function namedTypeList(schema: GraphQLSchema): GraphQLNamedType[] {
  return Object.values(schema.getTypeMap()).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )
}

export function TypeRef({
  type,
  onNavigate,
}: {
  type: GraphQLType
  onNavigate: (name: string) => void
}) {
  if (isNonNullType(type)) {
    return (
      <>
        <TypeRef type={type.ofType} onNavigate={onNavigate} />
        <span className="text-muted">!</span>
      </>
    )
  }
  if (isListType(type)) {
    return (
      <>
        <span className="text-muted">[</span>
        <TypeRef type={type.ofType} onNavigate={onNavigate} />
        <span className="text-muted">]</span>
      </>
    )
  }
  const named = type as GraphQLNamedType
  return (
    <button
      type="button"
      onClick={() => onNavigate(named.name)}
      className="bg-transparent border-0 p-0 cursor-pointer hover:underline"
      style={{ color: typeBadge(named).color }}
    >
      {named.name}
    </button>
  )
}

export function TypeRow({
  type,
  onNavigate,
}: {
  type: GraphQLNamedType
  onNavigate: (name: string) => void
}) {
  const badge = typeBadge(type)
  return (
    <button
      type="button"
      onClick={() => onNavigate(type.name)}
      className="w-full text-left flex items-center gap-2.5 px-1 py-1 rounded-[4px] hover:bg-subtle bg-transparent border-0 cursor-pointer group"
    >
      <span
        className="shrink-0 w-5 h-5 rounded-[4px] flex items-center justify-center font-mono text-[0.65rem] font-semibold"
        style={{ color: badge.color, backgroundColor: "var(--base02)" }}
      >
        {badge.letter}
      </span>
      <span
        className="min-w-0 truncate font-mono text-[0.82rem] font-semibold group-hover:underline"
        style={{ color: badge.color }}
      >
        {type.name}
      </span>
    </button>
  )
}
