import {
  type GraphQLArgument,
  type GraphQLNamedType,
  type GraphQLSchema,
  type GraphQLType,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isObjectType,
  isUnionType,
} from "graphql"
import { Fragment } from "react"
import { TypeRef, TypeRow, typeBadge } from "./schemaUtils"

interface DocField {
  name: string
  type: GraphQLType
  description?: string | null
  args: readonly GraphQLArgument[]
}

function SectionLabel({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center justify-between mt-3 mb-1.5 px-1">
      <span className="font-mono text-[0.65rem] uppercase tracking-wider text-muted">
        {label}
      </span>
      {count !== undefined && (
        <span className="font-mono text-[0.65rem] text-muted">{count}</span>
      )}
    </div>
  )
}

function Args({
  args,
  onNavigate,
}: {
  args: readonly GraphQLArgument[]
  onNavigate: (name: string) => void
}) {
  if (args.length === 0) return null
  return (
    <>
      <span className="text-muted">(</span>
      {args.map((a, i) => (
        <Fragment key={a.name}>
          {i > 0 && <span className="text-muted">, </span>}
          <span className="text-fg">{a.name}</span>
          <span className="text-muted">: </span>
          <TypeRef type={a.type} onNavigate={onNavigate} />
        </Fragment>
      ))}
      <span className="text-muted">)</span>
    </>
  )
}

function FieldRow({
  field,
  onNavigate,
}: {
  field: DocField
  onNavigate: (name: string) => void
}) {
  return (
    <div className="px-1 py-1.5">
      <div className="font-mono text-[0.8rem] leading-relaxed">
        <span className="text-fg font-semibold">{field.name}</span>
        <Args args={field.args} onNavigate={onNavigate} />
        <span className="text-muted">: </span>
        <TypeRef type={field.type} onNavigate={onNavigate} />
      </div>
      {field.description && (
        <p className="mt-0.5 text-[0.75rem] text-muted leading-snug">
          {field.description}
        </p>
      )}
    </div>
  )
}

/** Detail view for one named type: its fields/args/return types (navigable),
 *  enum values, or union members. */
export function TypeView({
  schema,
  name,
  onNavigate,
}: {
  schema: GraphQLSchema
  name: string
  onNavigate: (name: string) => void
}) {
  const type = schema.getType(name) as GraphQLNamedType | undefined
  if (!type) return <p className="px-1 text-muted text-sm">Unknown type.</p>

  const badge = typeBadge(type)
  const hasFields =
    isObjectType(type) || isInterfaceType(type) || isInputObjectType(type)
  const fields: DocField[] = hasFields
    ? Object.values(type.getFields()).map((f) => ({
        name: f.name,
        type: f.type,
        description: f.description,
        args: "args" in f ? f.args : [],
      }))
    : []

  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span
          className="shrink-0 w-6 h-6 rounded-[5px] flex items-center justify-center font-mono text-xs font-semibold"
          style={{ color: badge.color, backgroundColor: "var(--base02)" }}
        >
          {badge.letter}
        </span>
        <span
          className="font-mono text-[1.05rem] font-bold"
          style={{ color: badge.color }}
        >
          {type.name}
        </span>
      </div>
      {type.description && (
        <p className="mt-2 text-[0.82rem] text-muted leading-relaxed">
          {type.description}
        </p>
      )}

      {hasFields && (
        <>
          <SectionLabel label="Fields" count={fields.length} />
          {fields.map((f) => (
            <FieldRow key={f.name} field={f} onNavigate={onNavigate} />
          ))}
        </>
      )}

      {isUnionType(type) && (
        <>
          <SectionLabel label="Possible types" count={type.getTypes().length} />
          {type.getTypes().map((t) => (
            <TypeRow key={t.name} type={t} onNavigate={onNavigate} />
          ))}
        </>
      )}

      {isEnumType(type) && (
        <>
          <SectionLabel label="Values" count={type.getValues().length} />
          {type.getValues().map((v) => (
            <div key={v.name} className="px-1 py-1.5">
              <span className="font-mono text-[0.8rem] text-fg font-semibold">
                {v.name}
              </span>
              {v.description && (
                <p className="mt-0.5 text-[0.75rem] text-muted leading-snug">
                  {v.description}
                </p>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
