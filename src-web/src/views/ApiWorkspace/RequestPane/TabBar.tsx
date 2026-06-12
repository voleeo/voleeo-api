import { TabItem } from "@/components/Primitives"
import type { AuthConfig, HttpRequest } from "@/store/requests"
import { AuthTypeSelect } from "../AuthTab/AuthTypeSelect"
import type { SetAuth } from "../AuthTab/useAuthEditor"
import { BodyKindSelect } from "../BodyTab/BodyKindSelect"
import type { BodyKind } from "../BodyTab/useBodyEditor"
import type { InheritedHeader } from "../HeadersTab/InheritedHeaders"

export type RequestTab = "params" | "headers" | "body" | "auth"

interface Props {
  request: HttpRequest | null
  activeTab: RequestTab
  paramCounts: { enabled: number; total: number } | null
  inheritedHeaders: InheritedHeader[]
  auth: AuthConfig
  bodyKind: BodyKind
  onTabChange: (tab: RequestTab) => void
  onAuthChange: SetAuth
  onBodyKindChange: (kind: BodyKind) => void
}

export function countLabel(label: string, enabled: number, total: number) {
  if (total === 0) return label
  return (
    <>
      {label}{" "}
      <span className="font-normal opacity-40 tracking-normal">
        {enabled}/{total}
      </span>
    </>
  )
}

export function configuredLabel(label: string, configured: boolean) {
  if (!configured) return label
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
    </span>
  )
}

export function TabBar({
  request,
  activeTab,
  paramCounts,
  inheritedHeaders,
  auth,
  bodyKind,
  onTabChange,
  onAuthChange,
  onBodyKindChange,
}: Props) {
  const counts = request ? paramCounts : null
  const paramsLabel = counts
    ? countLabel("PARAMS", counts.enabled, counts.total)
    : "PARAMS"

  const hdrAll = (request?.headers ?? []).filter((h) => h.name.trim())
  const inherited = inheritedHeaders.filter((h) => !h.overridden).length
  const headersLabel = request
    ? countLabel(
        "HEADERS",
        hdrAll.filter((h) => h.enabled).length + inherited,
        hdrAll.length + inherited,
      )
    : "HEADERS"

  return (
    <div className="px-3.5 border-b border-border flex shrink-0">
      <TabItem
        label={paramsLabel}
        active={activeTab === "params"}
        onClick={() => onTabChange("params")}
      />
      <TabItem
        label={headersLabel}
        active={activeTab === "headers"}
        onClick={() => onTabChange("headers")}
      />
      <TabItem
        label={configuredLabel("BODY", bodyKind !== "none")}
        active={activeTab === "body"}
        onClick={() => onTabChange("body")}
      />
      <TabItem
        label={configuredLabel("AUTH", auth.kind !== "none")}
        active={activeTab === "auth"}
        onClick={() => onTabChange("auth")}
      />
      {activeTab === "body" && request && (
        <div className="ml-auto flex items-center">
          <BodyKindSelect bodyKind={bodyKind} onChange={onBodyKindChange} />
        </div>
      )}
      {activeTab === "auth" && request && (
        <div className="ml-auto flex items-center">
          <AuthTypeSelect auth={auth} onChange={onAuthChange} allowInherit />
        </div>
      )}
    </div>
  )
}
