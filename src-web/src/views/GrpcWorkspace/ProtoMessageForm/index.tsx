import type { ProtoMessageSchema } from "../../../../../packages/types/bindings"
import { type DescribeMessage, MessageFields } from "./fields"
import type { FormValue } from "./formValue"
import { VarClickContext } from "./varClick"

export type { DescribeMessage } from "./fields"
export { emptyMessage, parseMessage } from "./formValue"

export function ProtoMessageForm({
  schema,
  value,
  onChange,
  describeMessage,
  onVarClick,
}: {
  schema: ProtoMessageSchema
  value: FormValue
  onChange: (v: FormValue) => void
  describeMessage: DescribeMessage
  onVarClick?: (varName: string) => void
}) {
  return (
    <VarClickContext.Provider value={onVarClick}>
      <div className="px-3.5 py-2">
        {schema.fields.length === 0 ? (
          <p className="font-mono text-[0.857rem] text-muted py-2">
            {schema.name} has no fields — send an empty message.
          </p>
        ) : (
          <MessageFields
            schema={schema}
            value={value}
            onChange={onChange}
            describeMessage={describeMessage}
          />
        )}
      </div>
    </VarClickContext.Provider>
  )
}

export type { FormValue }
