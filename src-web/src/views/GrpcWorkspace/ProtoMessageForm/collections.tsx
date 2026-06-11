import { Glyph } from "@/components/Glyph"
import { Button } from "@/components/ui/button"
import type { ProtoFieldType } from "../../../../../packages/types/bindings"
import { type DescribeMessage, Widget } from "./fields"
import { emptyForType } from "./formValue"

export function RepeatedList({
  ty,
  value,
  onChange,
  describeMessage,
}: {
  ty: ProtoFieldType
  value: unknown[]
  onChange: (v: unknown[]) => void
  describeMessage: DescribeMessage
}) {
  return (
    <div className="flex flex-col gap-1.5 pl-3 border-l border-border">
      {value.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional list values
        <div key={i} className="flex items-center gap-2">
          <Widget
            ty={ty}
            value={item}
            onChange={(v) => onChange(value.map((x, j) => (j === i ? v : x)))}
            describeMessage={describeMessage}
          />
          <Button
            variant="subtle"
            size="icon-xs"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <Glyph kind="trash" size={12} />
          </Button>
        </div>
      ))}
      <Button
        variant="subtle"
        size="xs"
        onClick={() => onChange([...value, emptyForType(ty)])}
        className="self-start font-mono text-[0.72rem] border-border"
      >
        <Glyph kind="plus" size={11} />
        Add item
      </Button>
    </div>
  )
}

export function MapEditor({
  valueType,
  value,
  onChange,
  describeMessage,
}: {
  valueType: ProtoFieldType
  value: Record<string, unknown>
  onChange: (v: Record<string, unknown>) => void
  describeMessage: DescribeMessage
}) {
  const entries = Object.entries(value)
  return (
    <div className="flex flex-col gap-1.5 pl-3 border-l border-border">
      {entries.map(([k, v], i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional map rows
        <div key={i} className="flex items-center gap-2">
          <input
            className="w-32 bg-bg border border-border rounded-[5px] px-2 py-1 font-mono text-[0.857rem] text-fg outline-none focus:border-accent"
            value={k}
            placeholder="key"
            onChange={(e) => {
              const next: Record<string, unknown> = {}
              entries.forEach(([ek, ev], j) => {
                next[j === i ? e.target.value : ek] = ev
              })
              onChange(next)
            }}
          />
          <Widget
            ty={valueType}
            value={v}
            onChange={(nv) => onChange({ ...value, [k]: nv })}
            describeMessage={describeMessage}
          />
          <Button
            variant="subtle"
            size="icon-xs"
            onClick={() => {
              const next = { ...value }
              delete next[k]
              onChange(next)
            }}
          >
            <Glyph kind="trash" size={12} />
          </Button>
        </div>
      ))}
      <Button
        variant="subtle"
        size="xs"
        onClick={() => onChange({ ...value, "": emptyForType(valueType) })}
        className="self-start font-mono text-[0.72rem] border-border"
      >
        <Glyph kind="plus" size={11} />
        Add entry
      </Button>
    </div>
  )
}
