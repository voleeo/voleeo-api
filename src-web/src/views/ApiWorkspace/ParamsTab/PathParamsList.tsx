import type { CSSProperties } from "react"
import { DropLine } from "../DropLine"
import type { ParamDragHandle } from "../useParamDrag"
import { PathParamRow } from "./PathParamRow"

interface Props {
  pathParamDisplayOrder: string[]
  pathParamValues: Record<string, string>
  pathParamEnabled: Record<string, boolean>
  allPathParams: string[]
  colStyle: CSSProperties
  draggingKey: ParamDragHandle["draggingKey"]
  dropTarget: ParamDragHandle["dropTarget"]
  getStableKey: (name: string) => string
  togglePathParam: (name: string) => void
  updatePathParamValue: (name: string, val: string) => void
  renamePathParam: (oldName: string, newName: string) => void
  removePathParam: (name: string) => void
  pathParamInputRef: (name: string) => (el: HTMLDivElement | null) => void
  startDrag: ParamDragHandle["startDrag"]
  pendingKeyFocusName: string | null
  setPendingKeyFocusName: (name: string | null) => void
  onVarClick?: (varName: string) => void
  makeEncryptInsertHandler: (
    updateValue: (v: string) => void,
  ) => (plaintext: string) => Promise<void>
}

/** Renders the path-param rows section of ParamsTab, including drag drop-lines. */
export function PathParamsList({
  pathParamDisplayOrder,
  pathParamValues,
  pathParamEnabled,
  allPathParams,
  colStyle,
  draggingKey,
  dropTarget,
  getStableKey,
  togglePathParam,
  updatePathParamValue,
  renamePathParam,
  removePathParam,
  pathParamInputRef,
  startDrag,
  pendingKeyFocusName,
  setPendingKeyFocusName,
  onVarClick,
  makeEncryptInsertHandler,
}: Props) {
  return (
    <>
      {pathParamDisplayOrder.map((name, i) => (
        <div
          key={getStableKey(name)}
          data-param-section="path"
          data-param-index={i}
        >
          {dropTarget?.section === "path" && dropTarget.index === i && (
            <DropLine />
          )}
          <PathParamRow
            name={name}
            value={pathParamValues[name] ?? ""}
            enabled={pathParamEnabled[name] !== false}
            existingNames={allPathParams.filter((n) => n !== name)}
            colStyle={colStyle}
            isDragging={draggingKey === `path:${i}`}
            onToggle={() => togglePathParam(name)}
            onValueChange={(val) => updatePathParamValue(name, val)}
            onRename={renamePathParam}
            onRemove={() => removePathParam(name)}
            valueInputRef={pathParamInputRef(name)}
            onDragHandlePointerDown={(e) => startDrag(e, "path", i)}
            shouldFocusKey={pendingKeyFocusName === name}
            onKeyFocused={() => setPendingKeyFocusName(null)}
            onVarClick={onVarClick}
            onEncryptInsert={makeEncryptInsertHandler((val) =>
              updatePathParamValue(name, val),
            )}
          />
        </div>
      ))}
      {dropTarget?.section === "path" &&
        dropTarget.index === pathParamDisplayOrder.length && <DropLine />}
    </>
  )
}
