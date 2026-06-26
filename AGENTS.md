# AGENTS.md

Guidance for AI coding agents working in this repository.

**File-size rule:** this document must stay under 250 lines. When you add a new rule or section, tighten or remove existing content first — never just append. A bloated guide is read less, not more. Keep prose terse, examples one-line, and prefer references to inline duplication.

## Product vision

Voleeo is an **AI-native local toolkit with MCP bridge**. Every feature serves one goal: an AI agent (via MCP) and a developer share the same view of the system. UI, data models, and IPC are designed for both human and machine consumers.

## Model routing (delegated sub-work only)

Applies to subagents/workflows spawned via the Agent/Workflow tools — pick `model` per task. The **main session** model is user-controlled (`/model`) and never auto-switches; this table only routes delegated work. When unsure, step up a tier.

- **Haiku** — mechanical, fully-specified: keyword/file searches, fan-out reads (`Explore`), renames, formatting, log/grep scans, applying a known edit across files. Also commit messages and PR descriptions (use the cheapest tier).
- **Sonnet** — default for real work: feature implementation, code review, writing tests, focused single-file/single-bug debugging, doc edits.
- **Opus** — hard reasoning: architecture/design, cross-crate refactors, render-loop/concurrency/IPC-shape bugs (see numbered rules), security review, ambiguous multi-step tasks, adversarial verification of findings.

## Tool discipline

- **Locate before reading.** Use grep/find to confirm a file holds what you need before `Read`; never read whole directories.
- **Budget the work.** Aim to finish a task in under 20 tool calls. After ~10 calls with no visible progress, stop and explain the blocker rather than pushing on.

## Code quality

**KISS · DRY · YAGNI.** When planning and writing code, default to the simplest thing that works: stdlib or an already-installed dep before new code, one line before fifty, a native/CSS/DB feature before app code. Build nothing for a need that isn't here yet. Factor *real* duplication — never abstract speculatively (no interface with one impl, no config for a constant). Shortest working diff wins; if you can't name why a piece of code must exist, cut it.

**Single Responsibility.** Each file/component/hook does one thing. If you describe it with "and," split it.

**Readability over cleverness.** Functions short enough to read without scrolling. When a file grows, split into a directory: `index.tsx` orchestrates, hooks/sub-components own one concern each. Canonical examples: `components/ApiRequestTree/`, `views/ApiWorkspace/RequestPane/`, `views/ApiWorkspace/ResponsePane/TimelineTab/`.

**File limit: 250 lines** for `.tsx`/`.ts` in `src-web/src/`. **500 lines** for `.rs` files, excluding `#[cfg(test)]` blocks. Stop and split before adding more code.

**Rust test layout.** Public-API / fixture-driven tests live in `crates/<crate>/tests/<topic>.rs` with data under `tests/fixtures/<group>/`, `include_str!`'d instead of inline blobs — `voleeo-import` is the reference (`tests/openapi.rs` + `tests/fixtures/openapi/petstore.yaml`). Tests that exercise **private** items stay inline in `#[cfg(test)] mod tests` (the external `tests/` dir is a separate crate and can't see private/`pub(crate)` items) — never widen visibility just to relocate a test.

**Comments document the non-obvious.** Only comment important or hard logic — if the code already explains itself, skip it. Skip `// Foo` above a `<Foo/>`, section labels for self-evident JSX, JSDoc that restates the signature. Reserve comments for load-bearing context, surprising trade-offs, "why this and not the natural alternative," and footguns that cost someone an afternoon. Useful: `// Drain hops BEFORE pushing the error event — the policy callback fires after the awaiting task throws.` Useless: `// Set the active tab to params` above `setActiveTab("params")`.

**Terse, and audited every edit.** When a comment earns its place, say it in the fewest words — the *why* over the *what*; prune words that restate the code, collapse multi-line `///` blocks a sentence covers. This applies to *existing* comments in any file you touch, not just new ones: tighten or delete padding as part of the same change — editing is the only reliable moment to pay comment debt, not a future "cleanup pass" that never comes.

## Numbered rules

Several below are distilled from confirmed 100%+ CPU bugs in this codebase. Treat violations as bugs.

### React — render-loop prevention

**1. Inline callbacks as props that a child uses in `useEffect` deps cause infinite loops.** Wrap handlers in `useCallback` with the right deps. Real bug: passing `onParamCountChange={(e,t) => setParamCounts({e,t})}` → new fn ref each render → child effect fires → `setState` → re-render → 100% CPU.

**2. `setState` with object literals causes spurious re-renders.** `{ a, b }` is a new reference. Use functional form returning `prev` when values match: `setX(p => p?.a===a && p?.b===b ? p : { a, b })`.

**3. Memoize computed arrays/objects used as effect deps.** `[...a, ...b]` in render body is new every render. Wrap in `useMemo`.

**4. Always pass explicit `useEffect` dep arrays.** Never omit.

**5. `useRef` for non-rendering values** — flags, previous-value trackers, DOM refs, timer IDs. Every `setState` schedules a render.

**6. `useCallback` for handlers passed to `React.memo` children** — list items in particular (`VarRow`, `FolderRunRow`).

### Zustand subscriptions

**7. Selectors mandatory — never `useStore()` bare.** Bare = subscribes to everything; any `set()` re-renders. Use `useShallow((s) => ({ a: s.a, b: s.b }))` for multiple fields, or `s => s.a` for one.

**8. `getState()` for one-shot reads in event handlers** — no subscription overhead.

**9. Never store derived state.** Compute it with `useMemo` or a selector.

### DOM & listeners

**10. Document/window listeners must be removed in `useEffect` cleanup.** Never attach outside an effect.

**11. `getBoundingClientRect()` forces reflow.** Call only in event handlers / on dropdown open. Never in render, `useMemo`, or high-frequency effects.

**12. Guard `innerHTML` writes:** `if (el.innerHTML !== html) el.innerHTML = html`.

**13. `useLayoutEffect` only for pre-paint DOM reads/writes** (e.g. caret restore). Everything else: `useEffect`.

### Tauri IPC

**14. No `invoke()` on keystroke or in render.** Debounce or commit on blur/send. Keep `invoke()` in store actions.

**15. Use events (`emit`/`listen`), never polling.** Rust pushes; frontend subscribes once.

**16. Keep IPC payloads small.** Return only the changed entity from mutations, not full collections.

### Rust backend & Tauri v2 commands

**17. All commands `async`.** Offload blocking I/O (`std::fs`, sync `keyring`, …) via `tokio::task::spawn_blocking`. Blocking the runtime stalls every other command.

**18. Prefer `Arc<T>` for shared ownership; `Arc<RwLock<T>>` for read-heavy state.** Avoid cloning `Vec`/`String`/`HashMap` in hot paths.

**19. Hold `Mutex`/`RwLock` only across sync work — never across `.await`.** Deadlock/starvation hazard. Clone out, drop the guard, then await.

**20. Skip default-valued storage fields from YAML** via `#[serde(default, skip_serializing_if = …)]` — `Option::is_none` for options, an `is_false`/`is_default_*` predicate for bools/enums. A field that serializes its default value is a phantom git diff on every unrelated edit.

**21. Commands return `Result<T, VoleeoError>`.** Propagate with `?`; no `unwrap`/`panic` in command bodies. Register every new command in `tauri_specta::collect_commands!` inside `specta_builder()` (`src-tauri/src/lib.rs`), then `bun run codegen`.

**22. Capabilities entries are for plugins/core APIs** (`fs`, `dialog`, `shell`, …) in `src-tauri/capabilities/default.json`. Custom app commands need none — `collect_commands!` is enough. Apply least privilege.

**23. State management:** access via `tauri::State<'_, T>`; values passed to `.manage()` must be `Send + Sync`. Prefer `Arc<Mutex<T>>` / `Arc<RwLock<T>>` (tokio variants).

### Pre-flight checklist

- [ ] React render-loop guards: no bare `useStore()`, no inline props child effects depend on, computed effect-deps memoized, explicit dep arrays, listeners cleaned up
- [ ] No `invoke()` in render or high-frequency effects
- [ ] No `unwrap`/`panic` in Rust command handlers
- [ ] No blocking I/O in `async fn` without `spawn_blocking`
- [ ] Comments earn their keep
- [ ] `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build` all pass (production target ES2020)

## Commands

```bash
bun run dev          # Tauri + Vite HMR
bun run build        # production build
bun run codegen      # regenerate packages/types/bindings.ts
bun run typecheck
bun run test         # bun:test — colocated *.test.ts in src-web/src/lib/; runs in CI
bun run lint         # biome; lint:fix for auto-fix (pre-commit hook runs this)
cargo clippy --workspace
cargo fmt --all
cargo test -p voleeo-storage test_name
```

`bun run dev` runs `beforeDevCommand` (Vite :5173) then opens the Tauri window — both must run for IPC. Biome config in `src-web/biome.json` (2-space, double quotes, no semicolons). Pre-commit hook at `.git/hooks/pre-commit` auto-fixes staged files. Run `cargo fmt --all` before committing Rust — CI enforces `--check`.

## Commits & releases

**Conventional commits are mandatory** — versioning and release notes derive from them (`cliff.toml`). `release.yml` is **manual-only** (`workflow_dispatch` from the Actions tab or `gh workflow run release.yml`); it computes the next semver with git-cliff (`feat:` → minor, `fix:`/`perf:` → patch; `chore:`/`docs:`/`ci:`/`refactor:` → no release) and skips when there are no releasable commits since the last tag. The version lives in git tags only — CI injects it into `tauri.conf.json` at build time; never bump version fields manually. No `Co-Authored-By: Claude` trailers or AI attribution in commits/PRs.

## Toolchain

**Node 24.15.0** pinned in `.nvmrc`; `nvm use` activates (hook `direnv`/`zsh-nvm` for auto-activation). **Icons:** production in `src-tauri/icons/production/`, dev in `src-tauri/icons/dev/` — different bundles per build; regenerate with `bunx tauri icon <src.png> --output <dir>`.

## Architecture

### Workspace layout

```
packages/         shared TS — plugin-api (Theme, VoleeoPlugin contract)
plugins/themes/   first-party plugin shipping built-in base16 themes
crates/           pure Rust, zero Tauri deps
  voleeo-core     types, errors, traits
  voleeo-storage  YAML storage (workspaces, requests, folders)
  voleeo-crypto   AES-256-GCM + OS keychain
  voleeo-auth     request signing/encoding (digest, sigv4, oauth1, ntlm)
  voleeo-oauth    OAuth 2.0 token flow — loopback authorize + machine-local cache
  voleeo-http     reqwest-based HTTP executor
  voleeo-import   collection import — OpenAPI/Swagger/Postman/Insomnia → IR → core
  voleeo-ws       live WebSocket connections (Tauri-free HttpExecutor counterpart)
  voleeo-grpc     tonic-based gRPC — descriptor resolution, unary + streaming calls
  voleeo-cookies  cookie jar — model, matching, at-rest crypto
  voleeo-git      git2 wrapper for workspace sync (one repo == one workspace dir)
  voleeo-mcp      MCP server — protocol, tools, request resolution
crates-tauri/     Tauri-aware crates (voleeo-mac-window: macOS titlebar)
src-tauri/        app shell — assembles everything via Tauri commands
src-web/src/
  layout/         app chrome (TopBar, WorkspaceSwitcher, …)
  views/          full-screen tool views (ApiWorkspace, WelcomeScreen, …)
  components/     UI atoms (Glyph, Primitives, shadcn/ui)
  hooks/, config/ shared hooks; shortcuts.ts (KeyCombo registry)
  lib/            pure utilities — template.ts, caret.ts (no React/Tauri)
  store/          Zustand slices (one per domain)
```

**Invariant:** `crates/` never imports Tauri. `crates-tauri/` may import Tauri but not domain crates from `crates/` unless required. `src-tauri/` is the only assembly point.
Rust deps: `voleeo-core ←` every domain crate `← src-tauri`; `src-tauri` also depends on `crates-tauri/voleeo-mac-window`.

### IPC / type safety

All IPC types carry `#[derive(specta::Type)]`; commands annotated `#[specta::specta]`. `bun run codegen` regenerates `packages/types/bindings.ts` — never edit by hand.

`VoleeoError` is `#[serde(tag = "kind", content = "data")]` — pattern-match on `.kind`. Payload shape is **per-variant**: most carry a string, but `HttpFailed` carries `{ message, events }` and `Cancelled` is unit. Use `errorMessage(e)` from `@/lib/error` for display; read `.data` only when you specifically need the variant payload.

### HTTP execution & cancellation

`HttpExecutor` holds a long-lived `reqwest::Client` (built once in `AppState::new()`). Per-request state (start `Instant`, redirect hops) flows via `tokio::task_local!` — never via per-request `Client::builder()`. `HttpResponse.events: Vec<TimelineEvent>` is the canonical phase log (`config`, `send`, `dns`, `info`, `recv`, `chunk`, `redirect`, `error`, `done`); `TimelineTab` maps events directly to rows.

**In-flight cancellation.** `HttpExecutor` tracks active sends in `Arc<Mutex<HashMap<RequestId, oneshot::Sender<()>>>>`. `send()` races `send_inner` against `cancel_rx` via `tokio::select!`. Cancelled → `VoleeoError::Cancelled` (unit). `useHttpStore` special-cases `kind === "cancelled"`: no error banner, build a shell response whose Timeline shows pre-flight resolution + a "Request cancelled" row. Any `VoleeoError` matcher must handle `Cancelled` (no `.data`). The send button in `RequestActionBar` swaps to an `x` glyph while sending; click and Enter/⌘-Enter route to `cancelRequest`.

### gRPC execution (`voleeo-grpc`)

`DescriptorCache` (keyed by request id) resolves schemas via server reflection or local `.proto` compile (`protox`, offloaded to `spawn_blocking`); entries store their build inputs and self-invalidate when source/target/TLS change. `GrpcExecutor` runs unary calls — cancellation mirrors HTTP (`oneshot` + `select!`), and calls go through `server_streaming` so trailers are readable (tonic's `unary` swallows them). `GrpcManager` drives streaming calls, pushing `grpc:status`/`grpc:message`/`grpc:timeline` events. Send-time resolution lives in `voleeo_mcp::resolve` (`resolve_grpc_for_send`, `grpc_vars`) — Tauri commands and MCP tools both call it; never re-inline the env/folder/metadata pipeline.

### Plugins & theming

Plugins implement `VoleeoPlugin` from `@voleeo/plugin-api` and contribute `themes`, `templateFunctions`, and `requestActions` (all optional). There's a single API tool, so plugins have no workspace scoping — every contribution just applies; `PluginRegistry` (`src-web/src/plugins/`) flat-maps them. Rust persists opaque IDs only (e.g. `active_theme_id` in `settings.json`); `theme_activate` emits `theme:changed { id }`; each window's `useThemeStore` listener applies CSS custom properties on `:root`.

Themes use **base16** — 16 palette slots (`base00`…`base0F`). The palette is the **only** color source. `applyThemeToCss` writes 16 CSS vars; `@theme inline` in `styles/base.css` maps Tailwind utilities onto them. Use Tailwind utilities (`text-fg`, `bg-surface`, `text-accent`, …), never hardcoded hex. Inline `var(--baseXX)` only where Tailwind can't reach (SVG attrs, CodeMirror themes). No semantic CSS vars.

Slot summary: `base00` bg, `base01` surface, `base02` subtle, `base03` border/comments, `base04` muted, `base05` fg, `base08` error/red, `base0A` warn/yellow, `base0B` success/green, `base0C` info/cyan, `base0D` accent/blue, `base0E` keyword/purple. Method colors in `components/tokens.ts` (`C_*` constants + the `methodColor()` helper — reuse it, never re-derive the method→color switch). New theme: drop a 16-hex palette into `plugins/themes/src/themes/<id>.ts` and register it in the plugin index.

### Template expressions (`{{ … }}`)

Request fields support `{{ EXPR }}` tokens resolved at send time. Stored as literal text; UI renders chips.

| Expression | Stored as |
|---|---|
| Env var | `{{ AUTH_HOST }}` |
| No-arg fn | `{{ uuid.v4() }}` |
| Fn with args | `{{ uuid.v3(name="foo", namespace="…") }}` |

Key files: `lib/template.ts` (tokenize/serialize/toHtml/resolveTemplate — pure), `lib/caret.ts` (caret utilities), `hooks/useChipEditableHandlers.ts` (shared chip-editor core: undo/redo, chip deletion, caret snap), `components/TemplateInput/` (chip-rendering input + autocomplete), `components/EncryptedInput/` (sensitive-value field), `views/ApiWorkspace/UrlInput/` (URL bar extends with `:param` segments). The two editors compose the shared hook — fix chip behavior there, not in the wrappers.

**Critical:** Never read `el.textContent` to recover the stored value — chip display text differs. Always `extractStoredValue(el)`. Map caret offsets via `displayToStoredOffset`; chip ranges via `getChipRanges`.

### Imports, classNames, state, shortcuts

Use `@/` for `src-web/src/` imports (`@/store/requests`). Outside `src-web/src/` (e.g. `packages/types/bindings`) → relative paths.

Conditional classes: always `cn()` from `@/lib/utils`, never template-string `${cond?…:…}`.

Each tool (API) owns a Zustand slice; global state (theme, workspace, settings) in `src-web/src/store/`. Co-locate `invoke()` inside the relevant store slice.

Keyboard shortcuts in `src-web/src/config/shortcuts.ts` as named `KeyCombo` constants. Consume via `useKeydown(SHORTCUTS.X, handler)`. Never hardcode a combo inline. Every new shortcut must also be added to `SHORTCUT_HELP` in the same file with the correct `scope` so it appears in the Keyboard Shortcuts modal.

### Settings window

A second `WebviewWindow` labelled `"settings"` loads the same `index.html`. `App.tsx` branches on `getCurrentWindow().label` to render `<SettingsWindow>` instead of the main layout. macOS overlay titlebar applies only to `"main"`. `capabilities/default.json` lists both `"main"` and `"settings"` in `windows` — any new IPC-using window must be added there.

### MCP Bridge

Voleeo is an MCP **server**: AI clients connect over the bridge (stdio ↔ Unix socket `mcp.sock`) to the running app; auth via bearer token in `secrets.json`. Tool schemas live in `crates/voleeo-mcp/src/api/tools.rs`, handlers per domain file under `api/`, dispatch in `api/mod.rs` — new tools need all three plus a `#[tokio::test]`. The `voleeo-mcp-bridge` stdio↔socket relay is a Tauri sidecar: `tauri.conf.json` `beforeBuildCommand` compiles it and `externalBin` bundles it next to the main executable. `get_app_info` returns its on-disk path for users to wire into their MCP client; dev builds skip it via `tauri.dev.conf.json` (`externalBin: []`).

**Portal pattern:** any dropdown or modal that must escape an `overflow-hidden` ancestor uses `createPortal(…, document.body)` + `position: fixed` with coords from `getBoundingClientRect()`. Examples: `HistoryPicker`, `McpModal`.

### YAML storage & encryption

```
{app_data_dir}/
  settings.json                  global prefs: active_theme_id, mcp_enabled
  mcp.sock                       Unix socket for MCP bridge (always present, enabled checked per-request)
  secrets.json                   mode 0600; holds mcp_token
  keys/{workspace_id}.key        mode 0600; outside workspace dirs (no Git leak)
  workspaces/{workspace_id}/     real dir OR symlink → user sync dir
    workspace.yaml               id, name, model, encrypted, keyCheck, …
    req_{id}.yaml                HTTP request (auth secrets plaintext over IPC, ciphertext at rest)
    ws_{id}.yaml / grpc_{id}.yaml   WS connection / gRPC request (same auth handling)
    folder_{id}.yaml             request folder
  responses-local/{workspace_id}/   machine-local, never synced
    req_{request_id}.yaml        ring buffer of last 20 HttpResponses (newest first)
    grpc_resp_{rid}.yaml         gRPC unary ring buffer; ws_{cid}.yaml / grpc_{rid}.yaml hold WS/gRPC transcripts
```

`syncDir` is **never** in `workspace.yaml` — it's machine-local; `workspaces/{id}/` becomes a symlink. `derive_sync_dir()` reads `read_link` at runtime. Caller-supplied ids pass `validate_id` (`[A-Za-z0-9_-]`, ≤128) before any path construction — new storage paths must do the same.

**Encryption** (`voleeo-crypto`): per-workspace AES-256-GCM. Key stored in OS keychain and `{app_data_dir}/keys/{workspace_id}.key` as fallback. Display: 32 bytes as 8 dash-separated groups of 8 uppercase hex. `keyCheck` token in `workspace.yaml` verifies imported keys. Secrets travel plaintext over IPC; the backend encrypts at rest via `transform_secrets` (env) / `transform_auth_secrets` (request) in `src-tauri/src/commands/`. Encrypted workspaces also write ciphertext into the YAML. On save, reuse the stored ciphertext for any secret whose value is unchanged (`preserve_unchanged_secrets`) — AES-GCM's fresh nonce otherwise rewrites every secret on each edit, a phantom git diff.

### Pre-release development policy

Voleeo has not shipped: default to **no migration code or back-compat shims** for IPC shapes, runtime fallbacks reconstructing missing data, and theme/plugin contracts — delete code that only handles "older versions of our own code." **But weigh backward compatibility for critical changes to persisted data** (workspace/request YAML schema, encryption, on-disk layout): users now keep real git-synced workspaces, so keep old files readable (serde `default`/`rename`, tolerant parses) or call out the break — never silently corrupt or drop existing data. If a change touches data on disk, treat it as critical.
