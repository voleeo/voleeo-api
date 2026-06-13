import { useShallow } from "zustand/react/shallow"
import type { AuthProtocol } from "@/lib/authSchemes"
import { cn } from "@/lib/utils"
import {
  type ApiFolder,
  type AuthConfig,
  useRequestStore,
} from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import { AuthFields } from "./AuthFields"
import type { SetAuth } from "./useAuthEditor"

interface Props {
  auth: AuthConfig
  setAuth: SetAuth
  onVarClick: (varName: string) => void
  folderId?: string | null
  allowSourceSelect?: boolean
  protocol?: AuthProtocol
}

function SourceToggle({
  value,
  onChange,
}: {
  value: "folder" | "workspace"
  onChange: (next: "folder" | "workspace") => void
}) {
  const options: { value: "folder" | "workspace"; label: string }[] = [
    { value: "folder", label: "Folder" },
    { value: "workspace", label: "Workspace" },
  ]
  return (
    <div className="flex items-center gap-0.5 rounded-[6px] border border-border bg-bg p-[2px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "flex items-center px-2.5 py-0.5 rounded-[4px] border-0 outline-none cursor-pointer font-sans text-[0.857rem] transition-colors",
            o.value === value
              ? "bg-accent/15 text-accent"
              : "bg-transparent text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function workspaceAuthSource(
  workspaceAuth: AuthConfig | undefined,
): { kind: "workspace"; auth: AuthConfig } | null {
  if (
    workspaceAuth &&
    workspaceAuth.kind !== "none" &&
    workspaceAuth.kind !== "inherit"
  ) {
    return { kind: "workspace", auth: workspaceAuth }
  }
  return null
}

/** Walk ancestor folders nearest→root, returning the first whose auth is a real
 *  config — folder scope only, no workspace fallback. */
function findFolderAuthSource(
  folderId: string | null | undefined,
  folders: ApiFolder[],
): { kind: "folder"; folder: ApiFolder; auth: AuthConfig } | null {
  let current = folderId ?? null
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    seen.add(current)
    const folder = folders.find((f) => f.id === current)
    if (!folder) break
    const a = folder.auth
    if (a && a.kind !== "none" && a.kind !== "inherit") {
      return { kind: "folder", folder, auth: a }
    }
    current = folder.folderId ?? null
  }
  return null
}

export function AuthTab({
  auth,
  setAuth,
  onVarClick,
  folderId,
  allowSourceSelect = false,
  protocol,
}: Props) {
  const folders = useRequestStore(useShallow((s) => s.folders))
  const workspaceAuth = useUiStore((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId)
    return ws?.auth
  })

  if (auth.kind === "inherit") {
    const from = auth.from ?? "folder"
    const folderSrc = findFolderAuthSource(folderId, folders)
    const wsSrc = workspaceAuthSource(workspaceAuth)
    // The selected source wins; fall back to the other so the toggle only
    // matters when both exist.
    const source =
      from === "workspace" ? (wsSrc ?? folderSrc) : (folderSrc ?? wsSrc)
    // Only offer the choice when there's actually something to choose between.
    const showToggle = allowSourceSelect && !!folderSrc && !!wsSrc

    const preview =
      source?.kind === "folder" ? (
        <>
          Auth will be inherited from folder{" "}
          <span className="text-fg">{source.folder.name}</span> (
          {source.auth.kind}).
        </>
      ) : source?.kind === "workspace" ? (
        <>Auth will be inherited from this workspace ({source.auth.kind}).</>
      ) : (
        <>
          No folder or workspace defines an Auth — request will be sent with no
          auth.
        </>
      )

    if (!showToggle) {
      return (
        <div className="h-full flex items-center justify-center px-6 text-center">
          <p className="font-sans text-[0.929rem] text-muted">{preview}</p>
        </div>
      )
    }

    return (
      <div className="flex flex-col gap-4 px-3.5 py-3">
        <div className="flex items-center gap-3">
          <span className="font-sans text-[0.857rem] text-muted">
            Inherit from
          </span>
          <SourceToggle
            value={from}
            onChange={(next) => setAuth({ kind: "inherit", from: next })}
          />
        </div>
        <p className="font-sans text-[0.857rem] text-muted">{preview}</p>
      </div>
    )
  }

  if (auth.kind === "none") {
    return (
      <div className="h-full flex items-center justify-center text-muted font-sans text-[0.929rem]">
        No authentication will be sent with this request.
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4 px-3.5 py-3">
      <AuthFields
        auth={auth}
        setAuth={setAuth}
        onVarClick={onVarClick}
        protocol={protocol}
      />
    </div>
  )
}
