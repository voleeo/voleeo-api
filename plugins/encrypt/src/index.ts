import type { TemplateFunctionContribution, VoleeoPlugin } from "@voleeo/plugin-api"
import { commands } from "../../../packages/types/bindings"

const templateFunctions: TemplateFunctionContribution[] = [
  {
    name: "encrypt",
    label: "Securely store encrypted text",
    description:
      "Encrypts a plaintext value using workspace encryption and returns the ciphertext. " +
      "Workspace encryption must be enabled.",
    args: [
      {
        name: "value",
        label: "Value",
        type: "secret",
        required: true,
        description: "The plaintext to encrypt",
      },
    ],
    onRender: async (ctx, args) => {
      const raw = args.value ?? ""
      // workspaceEncryptValue returns "enc:v1:<base64ciphertext>".
      // If the value is already in that format, return it as-is (no re-encryption).
      if (raw.startsWith("enc:v1:")) return raw
      // Plaintext — encrypt now and return "enc:v1:<ciphertext>".
      const workspaceId = ctx.workspace.currentId()
      if (!workspaceId) throw new Error("No active workspace")
      const res = await commands.workspaceEncryptValue(workspaceId, raw)
      if (res.status === "error") {
        const err = res.error
        const msg =
          err.kind === "cancelled" || err.kind === "web_socket_closed"
            ? "Cancelled"
            : err.kind === "http_failed" || err.kind === "grpc_failed"
              ? err.data.message
              : err.data
        throw new Error(msg ?? "Encryption failed")
      }
      return res.data
    },
  },
]

export const plugin: VoleeoPlugin = {
  meta: {
    id: "@voleeo/encrypt",
    name: "Workspace Encryption",
    version: "1.0.0",
    author: "Voleeo",
  },
  templateFunctions,
}
