import { Segmented } from "@/components/Segmented"
import { methodColor } from "@/components/tokens"
import { type EntityChange, GROUP_ORDER } from "@/lib/gitEntityDiff"
import { useGitStore } from "@/store/git"
import { discardField, revealEntity } from "@/store/gitReview"
import { useEntityPatch, VIEW_MODES, type ViewMode } from "../diffMode"
import { EntityIcon } from "../EntityIcon"
import { RV } from "../reviewClasses"
import { DiffView } from "./DiffView"
import { FieldGroup } from "./FieldGroups"

const STATUS_META = {
  modified: { word: "Edited", color: "var(--accent)" },
  added: { word: "New", color: "var(--c-add)" },
  removed: { word: "Deleted", color: "var(--c-del)" },
} as const

export function ChangeDetail({
  entity,
  readOnly,
  viewMode,
  onViewModeChange,
}: {
  entity: EntityChange | null
  readOnly?: boolean
  viewMode?: ViewMode
  onViewModeChange?: (mode: ViewMode) => void
}) {
  const mode = viewMode ?? "summary"
  const entityDiff = useGitStore((s) => s.entityDiff)
  const patch = useEntityPatch(mode, entity?.path, entityDiff)

  if (!entity) {
    return <div className={RV.detailEmpty}>Select a change to review it.</div>
  }

  const sm = STATUS_META[entity.status]
  const groups = GROUP_ORDER.map((g) => ({
    g,
    items: entity.fields.filter((f) => f.group === g),
  })).filter((x) => x.items.length > 0)

  return (
    <>
      <div className={RV.detailHead}>
        <div className={RV.dhMain}>
          <div className={RV.dhTop}>
            {entity.type === "request" && entity.method ? (
              <span
                className={RV.methodLg}
                style={{ color: methodColor(entity.method) }}
              >
                {entity.method}
              </span>
            ) : (
              <EntityIcon type={entity.type} size={16} />
            )}
            <button
              type="button"
              className={RV.dhName}
              title="Open in the main window"
              onClick={() => revealEntity(entity.type, entity.nodeId)}
            >
              {entity.name}
            </button>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 font-sans text-[0.786rem] font-semibold"
            style={{
              color: sm.color,
              backgroundColor: `color-mix(in oklch, ${sm.color} 16%, transparent)`,
            }}
          >
            {sm.word}
          </span>
          {onViewModeChange && (
            <Segmented
              value={mode}
              options={VIEW_MODES}
              onChange={onViewModeChange}
            />
          )}
        </div>
      </div>

      {mode === "diff" ? (
        <div className="flex-1 min-h-0 overflow-auto">
          {patch === null ? (
            <div className={RV.detailEmpty}>Loading diff…</div>
          ) : (
            <DiffView patch={patch} />
          )}
        </div>
      ) : (
        <div className={RV.detailBody}>
          {groups.length === 0 ? (
            <div className={RV.detailEmpty}>No field-level changes.</div>
          ) : (
            groups.map(({ g, items }) => (
              <FieldGroup
                key={g}
                group={g}
                items={items}
                onDiscard={
                  readOnly || entity.status === "removed"
                    ? undefined
                    : (key) => discardField(entity, key)
                }
              />
            ))
          )}
        </div>
      )}
    </>
  )
}
