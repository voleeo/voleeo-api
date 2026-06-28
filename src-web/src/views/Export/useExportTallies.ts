import { useMemo } from "react"
import type {
  ExportFormat,
  ExportTarget,
} from "../../../../packages/types/bindings"

export function useExportTallies(
  targets: ExportTarget[],
  selectedIds: Set<string>,
  format: ExportFormat,
  includeEnvironments: boolean,
  includePrivate: boolean,
) {
  const selected = useMemo(
    () => targets.filter((t) => selectedIds.has(t.id)),
    [targets, selectedIds],
  )
  const isVoleeo = format === "voleeo"
  const envScope = isVoleeo || includeEnvironments
  const privScope = isVoleeo || includePrivate

  const grpcCount = useMemo(
    () => selected.reduce((a, t) => a + t.grpcCount, 0),
    [selected],
  )
  const wsCount = useMemo(
    () => selected.reduce((a, t) => a + t.wsCount, 0),
    [selected],
  )
  const totReq = useMemo(
    () => selected.reduce((a, t) => a + t.requests, 0),
    [selected],
  )
  const totEnv = useMemo(
    () =>
      envScope
        ? selected.reduce(
            (a, t) => a + t.sharedEnvs + (privScope ? t.privateEnvs : 0),
            0,
          )
        : 0,
    [selected, envScope, privScope],
  )
  const totSecrets = useMemo(
    () =>
      selected.reduce(
        (a, t) =>
          a +
          t.inlineSecrets +
          (envScope ? t.sharedSecrets + (privScope ? t.privateSecrets : 0) : 0),
        0,
      ),
    [selected, envScope, privScope],
  )
  const privateAvail = useMemo(
    () => selected.reduce((a, t) => a + t.privateEnvs, 0),
    [selected],
  )

  return {
    isVoleeo,
    envScope,
    privScope,
    grpcCount,
    wsCount,
    totReq,
    totEnv,
    totSecrets,
    privateAvail,
  }
}
