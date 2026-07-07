import type { RequestParameter } from "@/store/requests"
import { DropLine } from "../DropLine"
import { buildPathParams, rowsToParams } from "../paramUtils"
import { SelectAllToggle } from "../SelectAllToggle"
import { useMakeEncryptInsertHandler } from "../useMakeEncryptInsertHandler"
import { useParamDrag } from "../useParamDrag"
import { PathParamsList } from "./PathParamsList"
import type { ParamsCommit } from "./paramsCommit"
import { QueryParamRow } from "./QueryParamRow"
import { useParamCounts } from "./useParamCounts"
import { usePathParams } from "./usePathParams"
import { useQueryRows } from "./useQueryRows"

interface Props {
  sourceId: string
  url: string
  liveUrl: string
  parameters: RequestParameter[]
  workspaceId: string | null
  onCommit: ParamsCommit
  pathParamValues: Record<string, string>
  pathParamEnabled: Record<string, boolean>
  manualPathParamNames: string[]
  onPathParamValuesChange: (values: Record<string, string>) => void
  onPathParamEnabledChange: (enabled: Record<string, boolean>) => void
  onManualPathParamNamesChange: (names: string[]) => void
  onUrlChanged: (url: string) => void
  focusedPathParam?: string | null
  onFocusedPathParamConsumed?: () => void
  onParamCountChange?: (enabled: number, total: number) => void
  onVarClick?: (varName: string) => void
  pendingQueryParams?: Array<{ key: string; value: string }> | null
  onPendingQueryParamsConsumed?: () => void
}

export function ParamsTab({
  sourceId,
  url,
  liveUrl,
  parameters,
  workspaceId,
  onCommit,
  pathParamValues,
  pathParamEnabled,
  manualPathParamNames,
  onPathParamValuesChange,
  onPathParamEnabledChange,
  onManualPathParamNamesChange,
  onUrlChanged,
  focusedPathParam,
  onFocusedPathParamConsumed,
  onParamCountChange,
  onVarClick,
  pendingQueryParams,
  onPendingQueryParamsConsumed,
}: Props) {
  // usePathParams runs first — urlParamSet and setPendingKeyFocusName feed into useQueryRows.
  const {
    allPathParams,
    urlParamSet,
    pathParamDisplayOrder,
    setPathParamDisplayOrder,
    getStableKey,
    pathParamInputRef,
    pendingKeyFocusName,
    setPendingKeyFocusName,
    updatePathParamValue,
    togglePathParam,
    renamePathParam,
    removePathParam,
    commitPathParamsRef,
    commitWithUrlRef,
  } = usePathParams({
    url,
    liveUrl,
    pathParamValues,
    pathParamEnabled,
    manualPathParamNames,
    onPathParamValuesChange,
    onPathParamEnabledChange,
    onManualPathParamNamesChange,
    onUrlChanged,
    focusedPathParam,
    onFocusedPathParamConsumed,
    workspaceId,
  })

  const {
    rows,
    setRows,
    queryValueInputRefs,
    queryKeyInputRefs,
    updateRow,
    toggleRow,
    removeRow,
    suppressSync,
    commitRowsRef,
  } = useQueryRows({
    sourceId,
    url,
    parameters,
    pendingQueryParams,
    onPendingQueryParamsConsumed,
    urlParamSet,
    manualPathParamNames,
    onManualPathParamNamesChange,
    onPathParamValuesChange,
    pathParamValues,
    setPendingKeyFocusName,
  })

  // Update commit refs each render so async callbacks close over the latest state.
  commitRowsRef.current = async (next) => {
    const qParams = rowsToParams(next)
    suppressSync(JSON.stringify(qParams))
    await onCommit([
      ...buildPathParams(allPathParams, pathParamValues, pathParamEnabled),
      ...qParams,
    ])
  }

  commitPathParamsRef.current = async (newValues, newEnabled) => {
    const qParams = rowsToParams(rows)
    suppressSync(JSON.stringify(qParams))
    await onCommit([
      ...buildPathParams(allPathParams, newValues, newEnabled),
      ...qParams,
    ])
  }

  commitWithUrlRef.current = async (
    newUrl,
    pathNames,
    pathValues,
    pathEnabled,
  ) => {
    const qParams = rowsToParams(rows)
    suppressSync(JSON.stringify(qParams))
    await onCommit(
      [...buildPathParams(pathNames, pathValues, pathEnabled), ...qParams],
      { url: newUrl },
    )
  }

  const { totalParams, allEnabled, selectAll } = useParamCounts({
    allPathParams,
    pathParamEnabled,
    pathParamValues,
    rows,
    onParamCountChange,
    onPathParamEnabledChange,
    setRows,
    suppressSync,
    commit: onCommit,
  })

  const makeEncryptInsertHandler = useMakeEncryptInsertHandler(workspaceId)

  const { draggingKey, dropTarget, startDrag } = useParamDrag(
    (section, from, to) => {
      if (section === "path") {
        setPathParamDisplayOrder((prev) => {
          const next = [...prev]
          const [moved] = next.splice(from, 1)
          next.splice(to, 0, moved)
          return next
        })
      } else {
        setRows((prev) => {
          const next = [...prev]
          const [moved] = next.splice(from, 1)
          next.splice(to, 0, moved)
          void commitRowsRef.current(next)
          return next
        })
      }
    },
  )

  const colStyle = { gridTemplateColumns: "16px 8px 1fr 1fr 24px" }
  return (
    <div className="px-3.5 py-3 flex flex-col">
      <PathParamsList
        pathParamDisplayOrder={pathParamDisplayOrder}
        pathParamValues={pathParamValues}
        pathParamEnabled={pathParamEnabled}
        allPathParams={allPathParams}
        colStyle={colStyle}
        draggingKey={draggingKey}
        dropTarget={dropTarget}
        getStableKey={getStableKey}
        togglePathParam={togglePathParam}
        updatePathParamValue={updatePathParamValue}
        renamePathParam={renamePathParam}
        removePathParam={removePathParam}
        pathParamInputRef={pathParamInputRef}
        startDrag={startDrag}
        pendingKeyFocusName={pendingKeyFocusName}
        setPendingKeyFocusName={setPendingKeyFocusName}
        onVarClick={onVarClick}
        makeEncryptInsertHandler={makeEncryptInsertHandler}
      />

      {rows.map((row, rowIndex) => {
        const isTrailing =
          rowIndex === rows.length - 1 && row.key === "" && row.value === ""
        return (
          <div
            key={row._id}
            {...(!isTrailing && {
              "data-param-section": "query",
              "data-param-index": rowIndex,
            })}
          >
            {dropTarget?.section === "query" &&
              dropTarget.index === rowIndex && <DropLine />}
            <QueryParamRow
              row={row}
              isTrailing={isTrailing}
              isDragging={draggingKey === `query:${rowIndex}`}
              colStyle={colStyle}
              onKeyChange={(val) => updateRow(row._id, "key", val)}
              onValueChange={(val) => updateRow(row._id, "value", val)}
              onToggle={() => toggleRow(row._id)}
              onRemove={() => removeRow(row._id)}
              onDragStart={(e) => startDrag(e, "query", rowIndex)}
              onVarClick={onVarClick}
              onEncryptInsert={makeEncryptInsertHandler((val) =>
                updateRow(row._id, "value", val),
              )}
              valueInputRef={(el) => {
                if (el) queryValueInputRefs.current.set(row._id, el)
                else queryValueInputRefs.current.delete(row._id)
              }}
              keyInputRef={(el: HTMLDivElement | null) => {
                if (el) queryKeyInputRefs.current.set(row._id, el)
                else queryKeyInputRefs.current.delete(row._id)
              }}
            />
          </div>
        )
      })}

      {totalParams > 0 && (
        <SelectAllToggle allEnabled={allEnabled} onChange={selectAll} />
      )}
    </div>
  )
}
