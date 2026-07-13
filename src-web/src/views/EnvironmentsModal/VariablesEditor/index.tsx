import { useListDrag } from "@/hooks/useListDrag"
import { EnvVarKeySchema } from "@/lib/schemas"
import type { EnvironmentVariable } from "@/store/environment"
import { useVariableRows } from "./useVariableRows"
import { VarRow } from "./VarRow"

interface Props {
  source: EnvironmentVariable[]
  updatedAt: string
  onSave: (vars: EnvironmentVariable[]) => void
  onRename: (oldKey: string, newKey: string) => void
  query?: string
  focusKey?: string
  flashNonce?: number
}

export function VariablesEditor({
  source,
  updatedAt,
  onSave,
  onRename,
  query = "",
  focusKey,
  flashNonce,
}: Props) {
  const {
    variables,
    touchedRowIds,
    updateKey,
    updateValue,
    toggleEnabled,
    setEncrypted,
    removeVar,
    reorderVars,
    handleKeyFocus,
    handleKeyBlur,
  } = useVariableRows({ source, updatedAt, onSave, onRename })

  const { draggingIndex, dropIndex, startDrag } = useListDrag(reorderVars)
  const q = query.trim().toLowerCase()
  const matches = (v: EnvironmentVariable) =>
    !q || v.key.toLowerCase().includes(q) || v.value.toLowerCase().includes(q)
  const anyMatch = q ? variables.some(matches) : true

  return (
    <div className="flex flex-col">
      {!anyMatch && (
        <p className="px-1 py-2 font-mono text-[0.786rem] text-muted">
          No variables match “{query}”.
        </p>
      )}
      {variables.map((v, idx) => {
        if (!matches(v)) return null
        const keyError = v.key
          ? (EnvVarKeySchema.safeParse(v.key).error?.issues[0]?.message ?? null)
          : null
        const isDuplicate =
          !keyError &&
          v.key !== "" &&
          variables.some(
            (other) => other._rowId !== v._rowId && other.key === v.key,
          )
        return (
          <VarRow
            key={v._rowId}
            v={v}
            idx={idx}
            isTrailing={
              idx === variables.length - 1 && v.key === "" && v.value === ""
            }
            isTouched={touchedRowIds.current.has(v._rowId)}
            isDragging={draggingIndex === idx}
            keyError={keyError}
            isDuplicate={isDuplicate}
            dropIndex={dropIndex}
            onStartDrag={startDrag}
            onUpdateKey={updateKey}
            onUpdateValue={updateValue}
            onToggleEnabled={toggleEnabled}
            onSetEncrypted={setEncrypted}
            onRemove={removeVar}
            onKeyFocus={handleKeyFocus}
            onKeyBlur={handleKeyBlur}
            focusKey={focusKey}
            flashNonce={flashNonce}
          />
        )
      })}
    </div>
  )
}
