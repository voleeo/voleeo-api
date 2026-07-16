// Plugin root
export type { PluginMeta, VoleeoPlugin } from "./plugin"

// Host capabilities
export type { Context, PromptAskResult, RememberChoice } from "./context"

// Contribution types
export type { Base16Palette, Theme } from "./contributions/theme"
export type {
  PreviewResult,
  TemplateFunctionArg,
  TemplateFunctionContribution,
} from "./contributions/template-function"
export type { GrpcRequestActionContribution } from "./contributions/grpc-request-action"
export type { RequestActionContribution } from "./contributions/request-action"
