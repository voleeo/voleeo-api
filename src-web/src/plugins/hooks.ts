import type { Theme } from "@voleeo/plugin-api"
import { useSyncExternalStore } from "react"
import { registry } from "./registry"
import type {
  BoundGrpcRequestAction,
  BoundRequestAction,
  BoundTemplateFunction,
} from "./types"

export function useThemes(): Theme[] {
  return useSyncExternalStore(
    (cb) => registry.subscribe(cb),
    () => registry.themes(),
  )
}

export function useTemplateFunctions(): BoundTemplateFunction[] {
  return useSyncExternalStore(
    (cb) => registry.subscribe(cb),
    () => registry.templateFunctions(),
  )
}

export function useRequestActions(): BoundRequestAction[] {
  return useSyncExternalStore(
    (cb) => registry.subscribe(cb),
    () => registry.requestActions(),
  )
}

export function useGrpcRequestActions(): BoundGrpcRequestAction[] {
  return useSyncExternalStore(
    (cb) => registry.subscribe(cb),
    () => registry.grpcRequestActions(),
  )
}
