import { IconToggle } from "@/components/IconToggle"
import { TabItem } from "@/components/Primitives"
import { cn } from "@/lib/utils"
import { formatDuration } from "./format"
import type { HtmlView } from "./HtmlBody"
import type { SseView } from "./SseStreamTab/useSseView"
import type { CodeTools } from "./useCodeTools"

export type TabId = "body" | "headers" | "cookies" | "timeline"

function Count({ value }: { value: number | string }) {
  return (
    <span className="@max-[480px]:hidden font-normal opacity-40 tracking-normal">
      {value}
    </span>
  )
}

interface Props {
  tab: TabId
  setTab: (t: TabId) => void
  isSse: boolean
  frameCount: number
  headerCount: number
  cookieCount: number
  timingMs: number | null
  isHtml: boolean
  htmlView: HtmlView
  setHtmlView: (v: HtmlView) => void
  sseTools: boolean
  sseView: SseView
  showCodeTools: boolean
  canFilter: boolean
  codeTools: CodeTools
}

export function ResponseTabBar({
  tab,
  setTab,
  isSse,
  frameCount,
  headerCount,
  cookieCount,
  timingMs,
  isHtml,
  htmlView,
  setHtmlView,
  sseTools,
  sseView,
  showCodeTools,
  canFilter,
  codeTools,
}: Props) {
  return (
    <div className="pt-1.5 px-3.5 border-b border-border flex">
      <TabItem
        label={
          isSse && frameCount > 0 ? (
            <>
              RESPONSE <Count value={frameCount} />
            </>
          ) : (
            "RESPONSE"
          )
        }
        active={tab === "body"}
        onClick={() => setTab("body")}
      />
      <TabItem
        label={
          headerCount > 0 ? (
            <>
              HEADERS <Count value={headerCount} />
            </>
          ) : (
            "HEADERS"
          )
        }
        active={tab === "headers"}
        onClick={() => setTab("headers")}
      />
      <TabItem
        label={
          cookieCount > 0 ? (
            <>
              COOKIES <Count value={cookieCount} />
            </>
          ) : (
            "COOKIES"
          )
        }
        active={tab === "cookies"}
        onClick={() => setTab("cookies")}
      />
      <TabItem
        label={
          timingMs !== null ? (
            <>
              TIMING <Count value={formatDuration(timingMs)} />
            </>
          ) : (
            "TIMING"
          )
        }
        active={tab === "timeline"}
        onClick={() => setTab("timeline")}
      />
      {tab === "body" && isHtml && (
        <div className="ml-auto flex items-center gap-0.5 pr-0.5">
          {(["preview", "raw"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setHtmlView(m)}
              style={{ fontSize: "0.714rem" }}
              className={cn(
                "px-2 py-0.5 uppercase tracking-[0.3px] rounded-[3px] cursor-pointer transition-colors",
                htmlView === m
                  ? "text-accent bg-accent/10"
                  : "text-muted hover:text-fg",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      )}
      {sseTools && (
        <div className="ml-auto flex items-center gap-1 pr-0.5">
          <IconToggle
            glyph="search"
            title="Search & filter"
            active={sseView.searchOpen}
            onClick={() => sseView.setSearchOpen(!sseView.searchOpen)}
          />
          <IconToggle
            glyph="code"
            title={sseView.raw ? "Show parsed events" : "Show raw stream"}
            active={sseView.raw}
            onClick={() => sseView.setRaw(!sseView.raw)}
          />
        </div>
      )}
      {showCodeTools && (
        <div className="ml-auto flex items-center gap-1 pr-0.5">
          {canFilter && (
            <IconToggle
              glyph="filter"
              title="Filter (JSONPath / XPath)"
              active={codeTools.filterOpen}
              onClick={() =>
                codeTools.filterOpen
                  ? codeTools.closeFilter()
                  : codeTools.openFilter()
              }
            />
          )}
          <IconToggle
            glyph="search"
            title="Find in response"
            active={codeTools.findOpen}
            onClick={() =>
              codeTools.findOpen ? codeTools.closeFind() : codeTools.openFind()
            }
          />
        </div>
      )}
    </div>
  )
}
