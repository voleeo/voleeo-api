export const EVENTS = {
  // Cross-window workspace coordination
  workspaceAnnounce: "workspace:window:announce",
  workspaceRegistered: "workspace:window:registered",
  workspaceClose: "workspace:close",

  // Response history
  responseStored: "response:stored",
  mcpResponseStored: "mcp:response:stored",
  responseCleared: "response:cleared",

  // Git
  gitEntitiesReload: "git:entities-reload",
  gitReveal: "git:reveal",
  gitView: "git:view",
  gitStatusChanged: "git:status-changed",

  // Interface (layout/pane) sync across windows
  interfaceChanged: "interface:changed",

  // gRPC streaming (backend → frontend)
  grpcStatus: "grpc:status",
  grpcMessage: "grpc:message",
  grpcTimeline: "grpc:timeline",

  // WebSocket streaming (backend → frontend)
  wsStatus: "ws:status",
  wsMessage: "ws:message",
  wsTimeline: "ws:timeline",

  // SSE streaming (one frame per `text/event-stream` event, backend → frontend)
  sseFrame: "sse:frame",
  // Setup timeline (config/connect/headers) emitted once when the stream opens.
  sseOpen: "sse:open",

  // MCP-driven cache invalidation
  mcpRequestsChanged: "mcp:requests:changed",
  mcpEnvsChanged: "mcp:envs:changed",
  mcpCookiesChanged: "mcp:cookies:changed",
  mcpConnectionsChanged: "mcp:connections:changed",
  mcpGrpcChanged: "mcp:grpc:changed",
  mcpEnabledChanged: "mcp:enabled:changed",

  // Misc
  exportToast: "export:toast",
  settingsGotoSection: "settings:goto-section",
  oauth2TokenAcquired: "oauth2:token-acquired",
  themeChanged: "theme:changed",
  colorModeChanged: "color_mode:changed",
} as const
