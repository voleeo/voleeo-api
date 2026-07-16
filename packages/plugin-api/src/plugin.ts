import type { Context } from "./context"
import type { GrpcRequestActionContribution } from "./contributions/grpc-request-action"
import type { RequestActionContribution } from "./contributions/request-action"
import type { TemplateFunctionContribution } from "./contributions/template-function"
import type { Theme } from "./contributions/theme"

export interface PluginMeta {
  /** Globally unique identifier, e.g. "@voleeo/themes-voleeo". */
  id: string
  /** Human-readable display name. */
  name: string
  /** Semver version string. */
  version: string
  author?: string
}

export interface VoleeoPlugin {
  meta: PluginMeta

  /** Called once when the plugin is registered.  Use for async setup. */
  init?: (ctx: Context) => void | Promise<void>

  /** Called when the plugin is unregistered (app teardown or hot-reload). */
  dispose?: () => void | Promise<void>

  /** Visual themes contributed to the theme switcher. */
  themes?: Theme[]

  /** Template functions that can be called in URLs, headers, and bodies
   *  via {{ name(arg1, arg2) }} syntax. */
  templateFunctions?: TemplateFunctionContribution[]

  /** Actions that operate on a single HTTP request. Surface in the request-tree
   *  context menu; may optionally bind a keyboard shortcut. */
  requestActions?: RequestActionContribution[]

  /** Actions that operate on a single gRPC request. Surface on gRPC tree nodes. */
  grpcRequestActions?: GrpcRequestActionContribution[]
}
