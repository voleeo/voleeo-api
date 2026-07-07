import { useRequestStore } from "@/store/requests"
import type { SentRequestSnapshot } from "../types"

/** Where on the wire the resolved auth lands. The inheritance prefix is
 *  rendered separately by `AuthSub` so the folder can be a link. */
function authDestination(
  auth: SentRequestSnapshot["resolvedAuth"],
): string | undefined {
  switch (auth.kind) {
    case "bearer":
    case "basic":
      return "Encoded into Authorization header"
    case "api_key":
      return auth.apiKeyLocation === "query"
        ? "Appended to the URL query string"
        : "Sent as a request header"
    case "inherit":
      // Reached only when inheritance couldn't resolve to a real source.
      return "No folder or workspace defines an auth"
    default:
      return undefined
  }
}

/** Sub-line under the Auth value: an "Inherited from …" prefix (folder shown as
 *  a link that opens that folder) followed by the on-the-wire destination. */
export function AuthSub({
  auth,
}: {
  auth: SentRequestSnapshot["resolvedAuth"]
}) {
  const setActiveFolder = useRequestStore((s) => s.setActiveFolder)
  const destination = authDestination(auth)
  if (!destination) return null

  const folderId = auth.inheritedFromFolderId
  const folderName = auth.inheritedFromFolderName

  return (
    <>
      {folderName ? (
        <>
          Inherited from folder{" "}
          {folderId ? (
            <button
              type="button"
              onClick={() => setActiveFolder(folderId)}
              className="text-accent hover:underline cursor-pointer outline-none border-0 bg-transparent p-0 font-mono"
            >
              {folderName}
            </button>
          ) : (
            folderName
          )}
          {" > "}
        </>
      ) : auth.inheritedFromWorkspace ? (
        "Inherited from workspace > "
      ) : null}
      {destination}
    </>
  )
}
