import type {
  ProtoFieldSchema,
  ProtoFieldType,
  ProtoMessageSchema,
} from "../../../../../packages/types/bindings"
import { MapEditor, RepeatedList } from "./collections"
import { emptyForType, type FormValue, setKey } from "./formValue"
import { MessageRefField, NestedMessage } from "./nested"
import { BoolToggle, EnumSelect, FieldLabel, ScalarInput } from "./widgets"

export type DescribeMessage = (
  fullName: string,
) => Promise<ProtoMessageSchema | null>

interface WidgetProps {
  ty: ProtoFieldType
  value: unknown
  onChange: (v: unknown) => void
  describeMessage: DescribeMessage
}

/** Editor for a single element (no repetition), dispatched by type. */
export function Widget({ ty, value, onChange, describeMessage }: WidgetProps) {
  switch (ty.kind) {
    case "scalar":
      return ty.name === "bool" ? (
        <BoolToggle value={value} onChange={onChange} />
      ) : (
        <ScalarInput typeName={ty.name} value={value} onChange={onChange} />
      )
    case "enum":
      return <EnumSelect values={ty.values} value={value} onChange={onChange} />
    case "message":
      return (
        <NestedMessage
          schema={ty.schema}
          value={(value as FormValue) ?? {}}
          onChange={onChange}
          describeMessage={describeMessage}
        />
      )
    case "message_ref":
      return (
        <MessageRefField
          name={ty.name}
          value={(value as FormValue) ?? {}}
          onChange={onChange}
          describeMessage={describeMessage}
        />
      )
    case "map":
      return (
        <MapEditor
          valueType={ty.value}
          value={(value as Record<string, unknown>) ?? {}}
          onChange={onChange}
          describeMessage={describeMessage}
        />
      )
  }
}

function typeLabel(ty: ProtoFieldType): string {
  if (ty.kind === "scalar") return ty.name
  if (ty.kind === "map") return "map"
  if (ty.kind === "enum") return "enum"
  return "message"
}

export function FieldRow({
  field,
  value,
  onChange,
  describeMessage,
}: {
  field: ProtoFieldSchema
  value: unknown
  onChange: (v: unknown) => void
  describeMessage: DescribeMessage
}) {
  if (field.repeated && field.ty.kind !== "map") {
    return (
      <div className="flex flex-col gap-1.5 py-1">
        <FieldLabel name={`${field.name}[]`} type={typeLabel(field.ty)} />
        <RepeatedList
          ty={field.ty}
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
          describeMessage={describeMessage}
        />
      </div>
    )
  }

  const inline = field.ty.kind === "scalar" || field.ty.kind === "enum"
  return (
    <div
      className={
        inline ? "flex items-center gap-2 py-1" : "flex flex-col gap-1.5 py-1"
      }
    >
      <FieldLabel name={field.name} type={typeLabel(field.ty)} />
      <Widget
        ty={field.ty}
        value={value}
        onChange={onChange}
        describeMessage={describeMessage}
      />
    </div>
  )
}

export function MessageFields({
  schema,
  value,
  onChange,
  describeMessage,
}: {
  schema: ProtoMessageSchema
  value: FormValue
  onChange: (v: FormValue) => void
  describeMessage: DescribeMessage
}) {
  const oneofs = new Map<string, ProtoFieldSchema[]>()
  const plain: ProtoFieldSchema[] = []
  for (const f of schema.fields) {
    if (f.oneofGroup) {
      const list = oneofs.get(f.oneofGroup) ?? []
      list.push(f)
      oneofs.set(f.oneofGroup, list)
    } else plain.push(f)
  }

  return (
    <div className="flex flex-col">
      {plain.map((field) => (
        <FieldRow
          key={field.name}
          field={field}
          value={value[field.name]}
          onChange={(v) => onChange(setKey(value, field.name, v))}
          describeMessage={describeMessage}
        />
      ))}
      {[...oneofs.entries()].map(([group, members]) => (
        <OneofRow
          key={group}
          group={group}
          members={members}
          value={value}
          onChange={onChange}
          describeMessage={describeMessage}
        />
      ))}
    </div>
  )
}

function OneofRow({
  group,
  members,
  value,
  onChange,
  describeMessage,
}: {
  group: string
  members: ProtoFieldSchema[]
  value: FormValue
  onChange: (v: FormValue) => void
  describeMessage: DescribeMessage
}) {
  const chosen = members.find((m) => value[m.name] !== undefined) ?? null
  return (
    <div className="flex flex-col gap-1.5 py-1">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[0.72rem] text-accent w-40 shrink-0">
          oneof {group}
        </span>
        <select
          className="flex-1 bg-bg border border-border rounded-[5px] px-2 py-1 font-mono text-[0.857rem] text-fg outline-none focus:border-accent"
          value={chosen?.name ?? ""}
          onChange={(e) => {
            const next: FormValue = { ...value }
            for (const m of members) delete next[m.name]
            const pick = members.find((m) => m.name === e.target.value)
            if (pick) next[pick.name] = emptyForType(pick.ty)
            onChange(next)
          }}
        >
          <option value="">(none)</option>
          {members.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      {chosen && (
        <div className="pl-3 border-l border-border">
          <FieldRow
            field={chosen}
            value={value[chosen.name]}
            onChange={(v) => onChange(setKey(value, chosen.name, v))}
            describeMessage={describeMessage}
          />
        </div>
      )}
    </div>
  )
}
