import { TemplateInput } from "@/components/TemplateInput"
import type { ProtoEnumValue } from "../../../../../packages/types/bindings"
import { useVarClick } from "./varClick"

export const INPUT_CLS =
  "flex-1 min-w-0 bg-bg border border-border rounded-[5px] px-2 py-1 font-mono text-[0.857rem] text-fg outline-none focus:border-accent"

const NUMERIC = new Set([
  "int32",
  "uint32",
  "sint32",
  "fixed32",
  "sfixed32",
  "float",
  "double",
])

export function FieldLabel({ name, type }: { name: string; type: string }) {
  return (
    <div className="flex items-baseline gap-1.5 shrink-0 w-40">
      <span className="font-mono text-[0.857rem] text-fg truncate">{name}</span>
      <span className="font-mono text-[0.72rem] text-muted">{type}</span>
    </div>
  )
}

export function ScalarInput({
  typeName,
  value,
  onChange,
}: {
  typeName: string
  value: unknown
  onChange: (v: unknown) => void
}) {
  // Keep 64-bit ints + bytes as strings (proto3 JSON); coerce 32-bit/float.
  const isNumeric = NUMERIC.has(typeName)
  const onVarClick = useVarClick()
  const str = value === undefined || value === null ? "" : String(value)

  // String fields get the `{{ VAR }}` chip editor; numerics stay plain.
  if (!isNumeric) {
    return (
      <div className="flex-1 min-w-0 bg-bg border border-border rounded-[5px] px-2 py-1 font-mono text-[0.857rem] text-fg focus-within:border-accent">
        <TemplateInput
          value={str}
          onChange={onChange}
          placeholder={typeName}
          onVarClick={onVarClick}
          className="w-full"
        />
      </div>
    )
  }
  return (
    <input
      className={INPUT_CLS}
      value={str}
      placeholder={typeName}
      onChange={(e) => {
        const raw = e.target.value
        const n = Number(raw)
        onChange(raw === "" ? 0 : Number.isNaN(n) ? raw : n)
      }}
    />
  )
}

export function BoolToggle({
  value,
  onChange,
}: {
  value: unknown
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 font-mono text-[0.857rem] text-fg cursor-pointer">
      <input
        type="checkbox"
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
      />
      {value === true ? "true" : "false"}
    </label>
  )
}

export function EnumSelect({
  values,
  value,
  onChange,
}: {
  values: ProtoEnumValue[]
  value: unknown
  onChange: (v: string) => void
}) {
  return (
    <select
      className={INPUT_CLS}
      value={typeof value === "string" ? value : (values[0]?.name ?? "")}
      onChange={(e) => onChange(e.target.value)}
    >
      {values.map((v) => (
        <option key={v.name} value={v.name}>
          {v.name}
        </option>
      ))}
    </select>
  )
}
