import type { GitIdentity } from "../../../packages/types/bindings"
import { commands } from "../../../packages/types/bindings"
import { unwrap } from "./gitStoreUtil"

export type { GitIdentity }

export interface GitSettingsState {
  identity: GitIdentity | null
  credentialsUser: string | null
}

export async function loadGitSettings(
  workspaceId: string,
): Promise<GitSettingsState> {
  const [identity, credentialsUser] = await Promise.all([
    unwrap(commands.gitGetIdentity(workspaceId)),
    unwrap(commands.gitCredentialsUser(workspaceId)),
  ])
  return { identity, credentialsUser }
}

export function saveGitIdentity(
  workspaceId: string,
  name: string,
  email: string,
) {
  return unwrap(commands.gitSetIdentity(workspaceId, name, email))
}

export function saveGitCredentials(
  workspaceId: string,
  username: string,
  password: string,
) {
  return unwrap(commands.gitSetCredentials(workspaceId, username, password))
}

export function clearGitCredentials(workspaceId: string) {
  return unwrap(commands.gitClearCredentials(workspaceId))
}
