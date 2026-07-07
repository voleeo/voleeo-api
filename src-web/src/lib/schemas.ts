/**
 * Central Zod schema registry.
 *
 * Rules:
 * - Every external data boundary gets a schema: localStorage, URL params, invoke() results.
 * - Schemas live here so they're easy to find and keep in sync with bindings.ts.
 * - Use `.catch(fallback)` for optional / defaulted fields so stale stored data
 *   never hard-crashes the app; use `.parse()` only when a missing value is fatal.
 */
import { z } from "zod"

// Primitives

export const WorkspaceBehaviorSchema = z.enum(["ask", "current", "new"])

export const ToolSchema = z.enum(["welcome", "api"])

/** Non-empty string (trims before checking). */
export const NonEmptyStringSchema = z.string().trim().min(1)

/**
 * Valid env/folder variable key — the POSIX shell convention: a letter or `_`
 * first, then letters, digits and `_` (conventionally `UPPER_SNAKE_CASE`). No
 * hyphens, never a leading digit. Matches the `{{ VAR }}` token rule
 * (`parseExpr` / backend `is_identifier`) so every valid key resolves.
 */
export const EnvVarKeySchema = z
  .string()
  .regex(
    /^[a-zA-Z_][a-zA-Z0-9_]*$/,
    "Start with a letter or _, then A–Z, 0–9 and _",
  )

/** Hex color string (#rrggbb). */
export const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Must be a 6-digit hex color")

// localStorage

/**
 * Shape stored under "voleeo:interface".
 * All fields are optional — stored objects may be missing new fields added after first save.
 */
export const InterfaceStorageSchema = z
  .object({
    workspaceBehavior: WorkspaceBehaviorSchema.optional(),
    fontFamily: z.string().optional(),
    fontSize: z.number().positive().optional(),
    editorFontFamily: z.string().optional(),
    editorFontSize: z.number().positive().optional(),
    wrapResponse: z.boolean().optional(),
  })
  .catch({})

/** Panel sizes: array of positive numbers with exactly `length` entries. */
export function panelSizesSchema(length: number) {
  return z.array(z.number().positive()).length(length)
}

/** Closed folder IDs: array of non-empty strings. */
export const FolderIdsSchema = z.array(z.string()).catch([])

// URL params

/** Query params passed when opening a workspace in a new window. */
export const StartupParamsSchema = z.object({
  workspaceId: z.string().min(1).nullable(),
})

// Tauri invoke() responses

/** Shape of a Workspace returned by list_workspaces / rename_workspace etc.
 *  `headers`/`auth`/`dnsOverrides` are accepted as opaque pass-through — the
 *  Rust types are the runtime contract; we don't re-validate them in Zod. */
export const WorkspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  model: z.string(),
  encrypted: z.boolean().optional(),
  syncDir: z.string().nullable().optional(),
  keyCheck: z.string().nullable().optional(),
  headers: z.array(z.unknown()).optional(),
  auth: z.unknown().optional(),
  dnsOverrides: z.array(z.unknown()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const WorkspaceListSchema = z.array(WorkspaceSchema)

/** Shape of AppInfo returned by get_app_info. */
export const AppInfoSchema = z.object({
  version: z.string(),
  data_dir: z.string(),
  log_dir: z.string(),
})

/** theme_get_active returns an opaque string theme ID. */
export const ThemeIdSchema = z.string().min(1)
