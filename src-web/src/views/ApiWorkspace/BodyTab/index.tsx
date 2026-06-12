import { useRef } from "react"
import { BinaryBody } from "./BinaryBody"
import {
  BodyEditor,
  beautifyHtml,
  beautifyJson,
  beautifyXml,
} from "./BodyEditor"
import { FieldsBody } from "./FieldsBody"
import { GraphqlBody } from "./GraphqlBody"
import type { UseBodyEditorResult } from "./useBodyEditor"
import { EditorOverlayPortal, useEditorOverlay } from "./useEditorOverlay"

interface Props {
  body: UseBodyEditorResult
  onVarClick: (varName: string) => void
}

const RAW_KINDS = new Set(["json", "xml", "text", "html"])

export function BodyTab({ body, onVarClick }: Props) {
  const { bodyKind, bodyText, setBodyText } = body
  const { overlay, funcModal } = useEditorOverlay(setBodyText)

  // Stable ref so the CM chip-click handler never captures a stale callback.
  const onVarClickRef = useRef<((name: string) => void) | null>(onVarClick)
  onVarClickRef.current = onVarClick

  function handleBeautify() {
    const view = overlay.editorViewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    const beautified =
      bodyKind === "json"
        ? beautifyJson(current)
        : bodyKind === "xml"
          ? beautifyXml(current)
          : beautifyHtml(current)
    if (beautified === current) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: beautified },
    })
    setBodyText(beautified)
  }

  const isRaw = RAW_KINDS.has(bodyKind)

  return (
    <div className="flex flex-col h-full min-h-0">
      {isRaw && (
        <div className="flex-1 min-h-0 relative">
          <BodyEditor
            bodyKind={bodyKind}
            bodyText={bodyText}
            onVarClickRef={onVarClickRef}
            onFuncClickRef={funcModal.onFuncClickRef}
            overlay={overlay}
            onChange={setBodyText}
            onBeautify={handleBeautify}
          />
        </div>
      )}

      {bodyKind === "graphql" && (
        <GraphqlBody
          query={bodyText}
          onQueryChange={setBodyText}
          variables={body.graphqlVariables}
          onVariablesChange={body.setGraphqlVariables}
          onVarClick={onVarClick}
        />
      )}

      {(bodyKind === "form_url_encoded" || bodyKind === "multipart") && (
        <FieldsBody
          fields={body.bodyFields}
          allowFiles={bodyKind === "multipart"}
          onChange={body.setBodyFields}
          onVarClick={onVarClick}
        />
      )}

      {bodyKind === "binary" && (
        <BinaryBody
          path={body.binaryPath}
          contentType={body.binaryContentType}
          onChange={body.setBinary}
        />
      )}

      {bodyKind === "none" && (
        <div className="flex-1 flex items-center justify-center text-muted font-sans text-[0.929rem]">
          No request body
        </div>
      )}

      <EditorOverlayPortal overlay={overlay} />
      {funcModal.modal}
    </div>
  )
}
