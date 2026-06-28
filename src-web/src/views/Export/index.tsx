import { useEffect } from "react"
import { useShallow } from "zustand/react/shallow"
import { Glyph } from "@/components/Glyph"
import { useExportStore } from "@/store/export"
import { useUiStore } from "@/store/workspace"
import { PostmanIcon, VoleeoIcon } from "./brandIcons"
import { EnvironmentsSection } from "./EnvironmentsSection"
import { ExportFooter } from "./ExportFooter"
import { FormatCard } from "./FormatCard"
import { NotesSection } from "./NotesSection"
import { ProtocolsSection } from "./ProtocolsSection"
import { SectionLabel } from "./parts"
import { SecretWarning } from "./SecretWarning"
import { useExportTallies } from "./useExportTallies"
import { WorkspacesSection } from "./WorkspacesSection"

export function ExportWindow() {
  const {
    targets,
    selectedIds,
    format,
    includeEnvironments,
    includePrivate,
    exportProto,
    exportAsyncapi,
    ack,
    exporting,
    loaded,
    error,
    previewWarnings,
    loadTargets,
    loadPreview,
    toggle,
    toggleAll,
    setFormat,
    setIncludeEnvironments,
    setIncludePrivate,
    setExportProto,
    setExportAsyncapi,
    setAck,
    runExport,
  } = useExportStore(
    useShallow((s) => ({
      targets: s.targets,
      selectedIds: s.selectedIds,
      format: s.format,
      includeEnvironments: s.includeEnvironments,
      includePrivate: s.includePrivate,
      exportProto: s.exportProto,
      exportAsyncapi: s.exportAsyncapi,
      ack: s.ack,
      exporting: s.exporting,
      loaded: s.loaded,
      error: s.error,
      previewWarnings: s.previewWarnings,
      loadTargets: s.loadTargets,
      loadPreview: s.loadPreview,
      toggle: s.toggle,
      toggleAll: s.toggleAll,
      setFormat: s.setFormat,
      setIncludeEnvironments: s.setIncludeEnvironments,
      setIncludePrivate: s.setIncludePrivate,
      setExportProto: s.setExportProto,
      setExportAsyncapi: s.setExportAsyncapi,
      setAck: s.setAck,
      runExport: s.runExport,
    })),
  )
  const activeId = useUiStore((s) => s.activeWorkspaceId)

  const {
    isVoleeo,
    envScope,
    privScope,
    grpcCount,
    wsCount,
    totReq,
    totEnv,
    totSecrets,
    privateAvail,
  } = useExportTallies(
    targets,
    selectedIds,
    format,
    includeEnvironments,
    includePrivate,
  )

  useEffect(() => {
    void loadTargets()
  }, [loadTargets])

  // Refresh the notes whenever the selection, format, or a note-affecting option changes.
  useEffect(() => {
    void loadPreview(
      [...selectedIds],
      format,
      includeEnvironments,
      includePrivate,
      exportProto,
    )
  }, [
    loadPreview,
    selectedIds,
    format,
    includeEnvironments,
    includePrivate,
    exportProto,
  ])

  const exposed = totSecrets > 0
  const allOn = targets.length > 0 && selectedIds.size === targets.length
  const headerState: boolean | "mixed" = allOn
    ? true
    : selectedIds.size === 0
      ? false
      : "mixed"
  const canExport = selectedIds.size > 0 && (!exposed || ack)
  const label =
    selectedIds.size === 0
      ? "Select a workspace"
      : exposed && !ack
        ? "Acknowledge to export"
        : `Export ${selectedIds.size} as ${isVoleeo ? "Voleeo" : "Postman"}`

  const secretWarning = exposed ? (
    <SecretWarning
      count={totSecrets}
      ack={ack}
      onToggleAck={() => setAck(!ack)}
      embedded={!isVoleeo}
    />
  ) : null

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-4 border-b border-border px-6 py-5">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-[13px] border border-accent/30 bg-accent/15 text-accent">
          <Glyph kind="upload-simple" size={22} color="currentColor" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[1.286rem] font-bold text-fg">Export</div>
          <div className="mt-0.5 text-[0.929rem] text-muted">
            Save your workspaces as a portable collection or bundle.
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-[680px] flex-col gap-7">
          <div>
            <SectionLabel>Format</SectionLabel>
            <div className="flex gap-3">
              <FormatCard
                icon={<VoleeoIcon />}
                name="Voleeo Bundle"
                version="v1.0"
                desc={
                  "Everything in one lossless YAML.\nRe-importable into Voleeo."
                }
                selected={isVoleeo}
                onSelect={() => setFormat("voleeo")}
              />
              <FormatCard
                icon={<PostmanIcon />}
                name="Postman Collection"
                version="v2.1"
                desc={
                  "For Postman, Insomnia, and most API tools.\ngRPC/WebSocket exported as companion files."
                }
                selected={format === "postman"}
                onSelect={() => setFormat("postman")}
              />
            </div>
          </div>

          <WorkspacesSection
            targets={targets}
            selectedIds={selectedIds}
            activeId={activeId}
            envScope={envScope}
            privScope={privScope}
            allOn={allOn}
            headerState={headerState}
            loaded={loaded}
            onToggle={toggle}
            onToggleAll={toggleAll}
          />

          {!isVoleeo && (grpcCount > 0 || wsCount > 0) && (
            <ProtocolsSection
              grpcCount={grpcCount}
              wsCount={wsCount}
              exportProto={exportProto}
              exportAsyncapi={exportAsyncapi}
              setExportProto={setExportProto}
              setExportAsyncapi={setExportAsyncapi}
            />
          )}

          {!isVoleeo && (
            <EnvironmentsSection
              includeEnvironments={includeEnvironments}
              includePrivate={includePrivate}
              privateAvail={privateAvail}
              setIncludeEnvironments={setIncludeEnvironments}
              setIncludePrivate={setIncludePrivate}
            >
              {secretWarning}
            </EnvironmentsSection>
          )}

          {isVoleeo && secretWarning}

          {previewWarnings.length > 0 && (
            <NotesSection notes={previewWarnings} />
          )}

          {error && <div className="text-[0.857rem] text-error">{error}</div>}
        </div>
      </div>

      <ExportFooter
        workspaceCount={selectedIds.size}
        totReq={totReq}
        totEnv={totEnv}
        noteCount={previewWarnings.length}
        canExport={canExport}
        exporting={exporting}
        label={label}
        onExport={runExport}
      />
    </div>
  )
}
