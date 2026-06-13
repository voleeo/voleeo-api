import type { ResolutionEvent } from "@/lib/template"
import type { BoundTemplateFunction } from "@/plugins/types"
import type { CookieJar } from "@/store/cookies"
import type { EnvironmentVariable } from "@/store/environment"
import type {
  ApiFolder,
  AuthConfig,
  HttpRequest,
  RequestBody,
} from "@/store/requests"
import type { Workspace } from "@/store/workspace"
import type {
  RequestParameter,
  StoredCookie_Deserialize,
} from "../../../../../packages/types/bindings"

export interface ResolveSendInput {
  request: HttpRequest
  urlDraft: string
  pathParamValues: Record<string, string>
  pathParamEnabled: Record<string, boolean>
  vars: EnvironmentVariable[]
  templateFns: BoundTemplateFunction[]
  folders: ApiFolder[]
  workspace: Workspace
  activeJar?: CookieJar | null
  forSend?: boolean
}

export interface AnnotatedHeader {
  row: RequestParameter
  origin: "request" | "folder" | "workspace"
  folderName?: string
}

export interface ResolvedSendPayload {
  fullUrl: string
  headers: RequestParameter[]
  body: RequestBody | null
  resolutionEvents: ResolutionEvent[]
  cookies: StoredCookie_Deserialize[] | null
  headerOrigins: AnnotatedHeader[]
  resolvedAuth: AuthConfig
  dynamicAuthOverride?: AuthConfig
  inheritedAuthFolderId?: string
  inheritedAuthFolderName?: string
  inheritedAuthFromWorkspace?: boolean
}
