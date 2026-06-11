import { useState } from "react"
import { Glyph } from "@/components/Glyph"
import { Button } from "@/components/ui/button"
import type { ProtoMessageSchema } from "../../../../../packages/types/bindings"
import { type DescribeMessage, MessageFields } from "./fields"
import { emptyMessage, type FormValue } from "./formValue"

export function NestedMessage({
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
  const [open, setOpen] = useState(true)
  return (
    <div className="flex-1 min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 font-mono text-[0.72rem] text-muted hover:text-fg bg-transparent border-0 cursor-pointer p-0"
      >
        <Glyph kind={open ? "chevron-down" : "chevron"} size={12} />
        {schema.name}
      </button>
      {open && (
        <div className="pl-3 border-l border-border mt-1">
          <MessageFields
            schema={schema}
            value={value}
            onChange={onChange}
            describeMessage={describeMessage}
          />
        </div>
      )}
    </div>
  )
}

export function MessageRefField({
  name,
  value,
  onChange,
  describeMessage,
}: {
  name: string
  value: FormValue
  onChange: (v: FormValue) => void
  describeMessage: DescribeMessage
}) {
  const [schema, setSchema] = useState<ProtoMessageSchema | null>(null)
  if (schema) {
    return (
      <NestedMessage
        schema={schema}
        value={value}
        onChange={onChange}
        describeMessage={describeMessage}
      />
    )
  }
  return (
    <Button
      variant="subtle"
      size="xs"
      className="self-start font-mono text-[0.72rem] border-border"
      onClick={() => {
        void describeMessage(name).then((s) => {
          if (s) {
            setSchema(s)
            if (Object.keys(value).length === 0) onChange(emptyMessage(s))
          }
        })
      }}
    >
      <Glyph kind="plus" size={11} />
      {`Expand ${name}`}
    </Button>
  )
}
