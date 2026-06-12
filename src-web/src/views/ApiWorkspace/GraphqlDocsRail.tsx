import { useEffect, useRef } from "react"
import { useGraphqlSchemaStore } from "@/store/graphqlSchema"
import { usePaneTabsStore } from "@/store/paneTabs"
import { useRequestStore } from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import { GraphqlDocs } from "./BodyTab/GraphqlDocs"
import { PaneSeparator } from "./PaneSeparator"
import { useRailWidth } from "./useRailWidth"

export function GraphqlDocsRail() {
  const graphqlDocsOpen = useUiStore((s) => s.graphqlDocsOpen)
  const setGraphqlDocsOpen = useUiStore((s) => s.setGraphqlDocsOpen)
  const activeRequestId = useRequestStore((s) => s.activeRequestId)
  const schema = useGraphqlSchemaStore((s) =>
    activeRequestId ? s.schemas[activeRequestId] : undefined,
  )
  const isGraphqlRequest = useRequestStore(
    (s) =>
      s.requests.find((r) => r.id === s.activeRequestId)?.body?.kind ===
      "graphql",
  )
  const onBodyTab = usePaneTabsStore((s) =>
    activeRequestId ? s.requestTabs[activeRequestId] === "body" : false,
  )
  const { width, onSepDown } = useRailWidth()

  // Close when the user leaves the request or the Body tab.
  const prevReqRef = useRef(activeRequestId)
  useEffect(() => {
    if (!graphqlDocsOpen) {
      prevReqRef.current = activeRequestId
      return
    }
    const requestChanged = prevReqRef.current !== activeRequestId
    prevReqRef.current = activeRequestId
    if (requestChanged || !isGraphqlRequest || !onBodyTab) {
      setGraphqlDocsOpen(false)
    }
  }, [
    activeRequestId,
    graphqlDocsOpen,
    isGraphqlRequest,
    onBodyTab,
    setGraphqlDocsOpen,
  ])

  if (!graphqlDocsOpen || !isGraphqlRequest || !onBodyTab || !schema)
    return null

  return (
    <>
      <PaneSeparator dir="col" onMouseDown={onSepDown} />
      <div style={{ width }} className="shrink-0 h-full overflow-hidden">
        <GraphqlDocs
          schema={schema}
          onClose={() => setGraphqlDocsOpen(false)}
        />
      </div>
    </>
  )
}
