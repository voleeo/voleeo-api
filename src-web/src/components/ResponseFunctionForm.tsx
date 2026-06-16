import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type Strategy = "cache" | "refresh-after" | "force"

const INPUT_CLS =
  "font-mono text-[0.786rem] bg-bg border border-border rounded-[4px] px-2 py-1.5 text-fg outline-none focus:border-accent/60 placeholder:text-muted/40"

interface Props {
  isBody: boolean
  strategy: Strategy
  setStrategy: (v: Strategy) => void
  ttl: string
  setTtl: (v: string) => void
  selector: string
  setSelector: (v: string) => void
  headerName: string
  setHeaderName: (v: string) => void
  availableHeaders: string[]
  onAnyChange: () => void
}

export function ResponseFunctionForm({
  isBody,
  strategy,
  setStrategy,
  ttl,
  setTtl,
  selector,
  setSelector,
  headerName,
  setHeaderName,
  availableHeaders,
  onAnyChange,
}: Props) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label className="font-sans text-[0.786rem] text-muted font-medium">
          Execution strategy
        </label>
        <Select
          value={strategy}
          onValueChange={(v) => {
            setStrategy(v as Strategy)
            onAnyChange()
          }}
        >
          <SelectTrigger className="w-full font-mono text-[0.786rem] rounded-[4px] border-border bg-bg text-fg h-auto py-1.5 px-2 focus-visible:ring-0 focus-visible:border-accent/60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="font-mono text-[0.786rem]">
            <SelectItem value="cache">Cache — use stored response</SelectItem>
            <SelectItem value="refresh-after">Refresh after TTL</SelectItem>
            <SelectItem value="force">Force — always re-run</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {strategy === "refresh-after" && (
        <div className="flex flex-col gap-1.5">
          <label className="font-sans text-[0.786rem] text-muted font-medium">
            TTL (seconds)
          </label>
          <input
            type="number"
            min={1}
            value={ttl}
            onChange={(e) => {
              setTtl(e.target.value)
              onAnyChange()
            }}
            className={INPUT_CLS}
          />
        </div>
      )}

      {isBody ? (
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
            placeholder="$.access_token  or  //token/text()"
            autoComplete="off"
            spellCheck={false}
            className={INPUT_CLS}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label className="font-sans text-[0.786rem] text-muted font-medium">
            Header name <span className="text-accent">*</span>
          </label>
          <input
            type="text"
            value={headerName}
            onChange={(e) => {
              setHeaderName(e.target.value)
              onAnyChange()
            }}
            placeholder="content-type"
            autoComplete="off"
            spellCheck={false}
            className={INPUT_CLS}
          />
          {availableHeaders.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {availableHeaders.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => {
                    setHeaderName(h)
                    onAnyChange()
                  }}
                  className="font-mono text-[0.714rem] px-1.5 py-0.5 rounded-[3px] border border-border bg-subtle hover:bg-surface text-muted hover:text-fg cursor-pointer transition-colors"
                >
                  {h}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}
