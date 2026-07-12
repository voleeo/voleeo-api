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
  focusKey?: string
  flashNonce?: number
}

export function VariablesEditor({
  source,
  updatedAt,
  onSave,
  onRename,
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

  return (
    <div className="flex flex-col">
      {variables.map((v, idx) => {
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
