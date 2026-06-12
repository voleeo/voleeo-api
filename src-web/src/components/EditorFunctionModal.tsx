import { createPortal } from "react-dom"
import { useTemplateFunctions } from "@/plugins/hooks"
import {
  type RequestFnName,
  RequestFunctionModal,
} from "./RequestFunctionModal"
import { ResponseFunctionModal } from "./ResponseFunctionModal"
import { TemplateFunctionModal } from "./TemplateFunctionModal"

export function EditorFunctionModal({
  fnName,
  initialArgs,
  onInsert,
  onClose,
}: {
  fnName: string
  initialArgs: Record<string, string>
  onInsert: (args: Record<string, string>) => void
  onClose: () => void
}) {
  const fns = useTemplateFunctions()
  const modal =
    fnName === "response.body" || fnName === "response.header" ? (
      <ResponseFunctionModal
        fnName={fnName}
        initialArgs={initialArgs}
        onInsert={onInsert}
        onClose={onClose}
      />
    ) : fnName.startsWith("request.") ? (
      <RequestFunctionModal
        fnName={fnName as RequestFnName}
        initialArgs={initialArgs}
        onInsert={onInsert}
        onClose={onClose}
      />
    ) : (
      <TemplateFunctionModal
        fn={
          fns.find((f) => f.name === fnName) ??
          ({ name: fnName, onRender: () => "" } as never)
        }
        initialArgs={initialArgs}
        onInsert={onInsert}
        onClose={onClose}
      />
    )
  return createPortal(modal, document.body)
}
