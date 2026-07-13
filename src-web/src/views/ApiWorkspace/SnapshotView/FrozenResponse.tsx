import type { ReactNode } from "react"
import { useMemo, useState } from "react"
import { Glyph } from "@/components/Glyph"
import { ResponseHeader } from "@/components/ResponseHeader"
import { cn } from "@/lib/utils"
import { useInterfaceStore } from "@/store/interface"
import type { HttpResponse } from "../../../../../packages/types/bindings"
import { analyzeBody, BodyTab } from "../ResponsePane/BodyTab"
import { isHtmlResponse } from "../ResponsePane/bodyLang"
import { CookiesTab, collectReceivedRows } from "../ResponsePane/CookiesTab"
import { HeadersTab } from "../ResponsePane/HeadersTab"
import type { HtmlView } from "../ResponsePane/HtmlBody"
import { ResponseStatusLine } from "../ResponsePane/ResponseStatusLine"
import { ResponseTabBar, type TabId } from "../ResponsePane/ResponseTabBar"
import { codeBodyFlags } from "../ResponsePane/responsePaneHelpers"
import { useSseView } from "../ResponsePane/SseStreamTab/useSseView"
import { useCodeTools } from "../ResponsePane/useCodeTools"
import { DiffPanel } from "./DiffPanel"

function WrapToggle() {
  const wrap = useInterfaceStore((s) => s.wrapResponse)
  const setWrap = useInterfaceStore((s) => s.setWrapResponse)
  return (
    <button
      type="button"
      title={wrap ? "Disable line wrap" : "Wrap long lines"}
      onClick={() => setWrap(!wrap)}
      className={cn(
        "absolute top-1.5 right-4 z-10 p-1 rounded-[3px] border bg-transparent cursor-pointer transition-colors",
        wrap
          ? "border-accent/50 text-accent"
          : "border-border text-muted hover:text-fg hover:border-fg/30",
      )}
    >
      <Glyph kind="wrap" size={13} color="currentColor" />
    </button>
  )
}

const headersText = (r: HttpResponse) =>
  r.headers.map((h) => `${h.name}: ${h.value}`).join("\n")
const cookiesText = (r: HttpResponse) =>
  collectReceivedRows(r)
    .map((c) => `${c.name}: ${c.value}`)
    .join("\n")

export function FrozenResponse({
  response,
  trailing,
  diffAgainst,
}: {
  response: HttpResponse
  trailing?: ReactNode
  diffAgainst?: HttpResponse | null
}) {
  const [tab, setTab] = useState<TabId>("body")
  const [htmlView, setHtmlView] = useState<HtmlView>("preview")
  const codeTools = useCodeTools()
  const sseView = useSseView([], null)

  const bodyInfo = useMemo(() => analyzeBody(response), [response])
  const isHtml = isHtmlResponse(response)
  const { isCodeBody, canFilter } = codeBodyFlags(
    response,
    false,
    isHtml,
    bodyInfo,
  )
  const cookieCount = useMemo(
    () => collectReceivedRows(response).length,
    [response],
  )
  const diffing = Boolean(diffAgainst)

  return (
    <div className="@container flex-1 min-h-0 flex flex-col overflow-hidden">
      <ResponseHeader trailing={trailing}>
        <ResponseStatusLine
          error={undefined}
          loading={false}
          liveHeader={undefined}
          liveTimingMs={null}
          liveBytes={0}
          response={response}
          historicalResponse={null}
          isLatestHistory
          selectedHistoryRecordedAt={null}
          hideTiming
        />
      </ResponseHeader>

      <ResponseTabBar
        tab={tab}
        setTab={setTab}
        isSse={false}
        frameCount={0}
        headerCount={response.headers.length}
        cookieCount={cookieCount}
        timingMs={null}
        showTiming={false}
        isHtml={isHtml}
        htmlView={htmlView}
        setHtmlView={setHtmlView}
        sseTools={false}
        sseView={sseView}
        showCodeTools={!diffing && tab === "body" && isCodeBody}
        canFilter={canFilter}
        codeTools={codeTools}
      />

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden min-w-[270px] bg-bg">
        {diffing && diffAgainst ? (
          <div className="relative flex-1 min-h-0">
            {tab === "body" && <WrapToggle />}
            <div className="absolute inset-0 overflow-auto">
              {tab === "body" && (
                <DiffPanel
                  savedBody={response.body}
                  freshBody={diffAgainst.body}
                  isText={response.bodyIsText}
                />
              )}
              {tab === "headers" && (
                <DiffPanel
                  savedBody={headersText(response)}
                  freshBody={headersText(diffAgainst)}
                  isText
                />
              )}
              {tab === "cookies" && (
                <DiffPanel
                  savedBody={cookiesText(response)}
                  freshBody={cookiesText(diffAgainst)}
                  isText
                />
              )}
            </div>
          </div>
        ) : (
          <>
            {tab === "body" && (
              <BodyTab
                response={response}
                loading={false}
                htmlView={htmlView}
                body={bodyInfo}
                tools={codeTools}
              />
            )}
            {tab === "headers" && (
              <HeadersTab response={response} loading={false} />
            )}
            {tab === "cookies" && (
              <CookiesTab response={response} loading={false} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
