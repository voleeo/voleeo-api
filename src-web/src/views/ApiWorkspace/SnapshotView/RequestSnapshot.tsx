import { useMemo } from "react"
import { TabItem } from "@/components/Primitives"
import { isAuthEnabled } from "@/lib/authSchemes"
import { usePaneTabsStore } from "@/store/paneTabs"
import type { HttpRequest } from "../../../../../packages/types/bindings"
import { AuthFields } from "../AuthTab/AuthFields"
import { configuredLabel, countLabel } from "../RequestPane/TabBar"
import { CodeBody } from "../ResponsePane/CodeBody"
import { useCodeTools } from "../ResponsePane/useCodeTools"
import { bodyLangForKind, FrozenActionBar, KVTable } from "./parts"

/** Snapshots are immutable, so edits are dropped. */
const noop = () => {}

type Tab = "params" | "headers" | "body" | "auth"

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

const enabledRows = (
  ps: { name: string; value: string; enabled: boolean }[] | undefined,
) =>
  (ps ?? [])
    .filter((p) => p.enabled)
    .map(({ name, value }) => ({ name, value }))

const enabledHeaderRows = (
  ps:
    | { id: string; name: string; value: string; enabled: boolean }[]
    | undefined,
) =>
  (ps ?? [])
    .filter((p) => p.enabled)
    .map(({ id, name, value }) => ({ name, value, secret: id === "__auth" }))

export function RequestSnapshot({
  snapshotId,
  request,
  replaying,
  onReplay,
}: {
  snapshotId: string
  request: HttpRequest
  replaying: boolean
  onReplay: () => void
}) {
  const tab =
    (usePaneTabsStore((s) => s.snapshotTabs[snapshotId]) as Tab) ?? "params"
  const setTab = (next: Tab) =>
    usePaneTabsStore.getState().setSnapshotTab(snapshotId, next)
  const tools = useCodeTools()

  const params = useMemo(() => enabledRows(request.parameters), [request])
  const headers = useMemo(() => enabledHeaderRows(request.headers), [request])
  const bodyText = request.body?.text ?? ""
  const bodyLang = bodyLangForKind(request.body?.kind)
  const displayBody = useMemo(
    () => (bodyLang === "json" ? prettyJson(bodyText) : bodyText),
    [bodyText, bodyLang],
  )

  const hasBody = bodyText.trim().length > 0
  const authActive =
    !!request.auth &&
    request.auth.kind !== "none" &&
    request.auth.kind !== "inherit" &&
    isAuthEnabled(request.auth)
  const authKind = authActive ? (request.auth?.kind ?? "none") : "none"
  const totalParams = request.parameters?.length ?? 0
  const totalHeaders = request.headers?.length ?? 0

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <FrozenActionBar
        method={request.method}
        url={request.url}
        replaying={replaying}
        onReplay={onReplay}
      />

      <div className="px-3.5 border-b border-border flex shrink-0 min-w-[220px]">
        <TabItem
          label={countLabel("PARAMS", params.length, totalParams)}
          active={tab === "params"}
          onClick={() => setTab("params")}
        />
        <TabItem
          label={countLabel("HEADERS", headers.length, totalHeaders)}
          active={tab === "headers"}
          onClick={() => setTab("headers")}
        />
        <TabItem
          label={configuredLabel("BODY", hasBody)}
          active={tab === "body"}
          onClick={() => setTab("body")}
        />
        <TabItem
          label={configuredLabel("AUTH", authKind !== "none")}
          active={tab === "auth"}
          onClick={() => setTab("auth")}
        />
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden min-w-[270px] bg-bg">
        {tab === "params" && (
          <KVTable rows={params} emptyLabel="No query params" />
        )}
        {tab === "headers" && (
          <KVTable rows={headers} emptyLabel="No headers" />
        )}
        {tab === "body" &&
          (hasBody ? (
            <CodeBody rawText={displayBody} lang={bodyLang} tools={tools} />
          ) : (
            <div className="px-3.5 py-3 text-xs text-muted font-sans">
              No body
            </div>
          ))}
        {tab === "auth" &&
          (authKind === "none" ? (
            <div className="px-3.5 py-3 font-sans text-[0.786rem] text-muted">
              No auth
            </div>
          ) : (
            <div
              className="px-3.5 py-4 overflow-auto [&_button]:pointer-events-none"
              onBeforeInput={(e) => e.preventDefault()}
              onPaste={(e) => e.preventDefault()}
              onDrop={(e) => e.preventDefault()}
            >
              {request.auth && (
                <AuthFields
                  auth={request.auth}
                  setAuth={noop}
                  onVarClick={noop}
                  protocol="http"
                  hideToggle
                />
              )}
            </div>
          ))}
      </div>
    </div>
  )
}
