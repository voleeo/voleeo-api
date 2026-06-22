export interface McpClient {
  id: string
  name: string
  initials: string
  avatarColor: string
  tagline: string
  instructions: string[]
  snippetFile: string
  getSnippet: (bridgePath: string, token: string) => string
}

function jsonConfig(bridgePath: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        voleeo: {
          command: bridgePath,
          env: { VOLEEO_MCP_TOKEN: token },
        },
      },
    },
    null,
    2,
  )
}

export const MCP_CLIENTS: McpClient[] = [
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    initials: "CD",
    avatarColor: "var(--base0D)",
    tagline: "Connect via claude_desktop_config.json",
    instructions: [
      "Ensure Claude Desktop is installed and up to date.",
      "Open Settings → Developer → Edit Config and add the snippet below.",
      "Restart Claude Desktop to apply the changes.",
    ],
    snippetFile:
      "claude_desktop_config.json (Settings → Developer → Edit Config)",
    getSnippet: jsonConfig,
  },
  {
    id: "claude-code",
    name: "Claude Code",
    initials: "CC",
    avatarColor: "var(--base0E)",
    tagline: "Connect via the Claude Code CLI",
    instructions: [
      "Install the Claude Code CLI if needed: npm i -g @anthropic-ai/claude-code.",
      "Run the command below once in your terminal.",
      "Voleeo will appear as an MCP server in every Claude Code session.",
    ],
    snippetFile: "Terminal",
    getSnippet: (bridgePath, token) =>
      `claude mcp add voleeo -e VOLEEO_MCP_TOKEN=${token} -- ${bridgePath}`,
  },
  {
    id: "cursor",
    name: "Cursor",
    initials: "Cu",
    avatarColor: "var(--base0C)",
    tagline: "Connect via ~/.cursor/mcp.json",
    instructions: [
      "Open Cursor and navigate to Settings → MCP, or edit the file directly.",
      "Add the snippet below to ~/.cursor/mcp.json.",
      "Reload the Cursor window (⌘⇧P → Reload Window) to connect.",
    ],
    snippetFile: "~/.cursor/mcp.json",
    getSnippet: jsonConfig,
  },
  {
    id: "opencode",
    name: "Opencode",
    initials: "Oc",
    avatarColor: "var(--base09)",
    tagline: "Connect via opencode config",
    instructions: [
      "Install opencode if needed: npm i -g opencode-ai.",
      "Add the snippet below to ~/.config/opencode/config.json.",
      "Start a new opencode session to pick up the change.",
    ],
    snippetFile: "~/.config/opencode/config.json",
    getSnippet: jsonConfig,
  },
  {
    id: "codex",
    name: "OpenAI Codex",
    initials: "Cx",
    avatarColor: "var(--base0B)",
    tagline: "Connect via Codex CLI config",
    instructions: [
      "Install the OpenAI Codex CLI: npm i -g @openai/codex.",
      "Add the snippet below to ~/.codex/config.json.",
      "Run codex in a new terminal session to connect.",
    ],
    snippetFile: "~/.codex/config.json",
    getSnippet: jsonConfig,
  },
  {
    id: "antigravity",
    name: "Google Antigravity",
    initials: "GA",
    avatarColor: "var(--base08)",
    tagline: "Connect via Antigravity MCP config",
    instructions: [
      "Install Google Antigravity and ensure it is on v1.2 or later.",
      "Add the snippet below to your Antigravity MCP server config.",
      "Restart the agent to establish the connection.",
    ],
    snippetFile: "~/.antigravity/mcp.json",
    getSnippet: jsonConfig,
  },
]
