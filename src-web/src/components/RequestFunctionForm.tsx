import type { RequestFnName } from "./RequestFunctionModal"

interface Props {
  fnName: RequestFnName
  name: string
  setName: (v: string) => void
  selector: string
  setSelector: (v: string) => void
  hasSourceReq: boolean
  availableNames: string[]
  onAnyChange: () => void
}

const INPUT_CLS =
  "font-mono text-[0.786rem] bg-bg border border-border rounded-[4px] px-2 py-1.5 text-fg outline-none focus:border-accent/60 placeholder:text-muted/40"

export function RequestFunctionForm({
  fnName,
  name,
  setName,
  selector,
  setSelector,
  hasSourceReq,
  availableNames,
  onAnyChange,
}: Props) {
  if (fnName === "request.body") {
    return (
      <div className="flex flex-col gap-1.5">
        <label className="font-sans text-[0.786rem] text-muted font-medium">
          Selector{" "}
          <span className="font-normal text-muted/60">
            — empty = full body, $… = JSONPath, /… = XPath
          </span>
        </label>
        <input
          type="text"
          value={selector}
          onChange={(e) => {
            setSelector(e.target.value)
            onAnyChange()
          }}
          placeholder="$.user.id  or  //user/id/text()"
          autoComplete="off"
          spellCheck={false}
          className={INPUT_CLS}
        />
      </div>
    )
  }

  const emptyMsg =
    fnName === "request.path"
      ? "path params"
      : fnName === "request.query"
        ? "query params"
        : "headers"

  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-sans text-[0.786rem] text-muted font-medium">
        {fnName === "request.header" ? "Header name" : "Param name"}{" "}
        <span className="text-accent">*</span>
      </label>
      <input
        type="text"
        value={name}
        onChange={(e) => {
          setName(e.target.value)
          onAnyChange()
        }}
        placeholder={fnName === "request.header" ? "content-type" : "id"}
        autoComplete="off"
        spellCheck={false}
        className={INPUT_CLS}
      />
      {hasSourceReq && availableNames.length === 0 && (
        <span className="font-sans text-[0.714rem] text-muted/60">
          This request has no {emptyMsg}.
        </span>
      )}
      {availableNames.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-0.5">
          {availableNames.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                setName(n)
                onAnyChange()
              }}
              className="font-mono text-[0.714rem] px-1.5 py-0.5 rounded-[3px] border border-border bg-subtle hover:bg-surface text-muted hover:text-fg cursor-pointer transition-colors"
            >
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
