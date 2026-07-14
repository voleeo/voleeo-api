import { useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { Glyph } from "@/components/Glyph"
import { InlineNewNavItem } from "@/components/InlineNewNavItem"
import { ManagementModal } from "@/components/ManagementModal"
import { DEFAULT_JAR_ID, useCookiesStore } from "@/store/cookies"
import { CookieEditor } from "./CookieEditor"
import { CookieList } from "./CookieList"
import { JarRow } from "./JarRow"

interface Props {
  workspaceId: string
  onClose: () => void
}

export function CookiesModal({ workspaceId, onClose }: Props) {
  const { jars, activeJarId, createJar } = useCookiesStore(
    useShallow((s) => ({
      jars: s.jars,
      activeJarId: s.activeJarId,
      createJar: s.createJar,
    })),
  )

  // The selected jar drives the cookie-list pane; the active jar (the one the
  // executor attaches cookies from) is a separate piece of state managed by
  // JarRow's radio. Selection defaults to active so opening lands on the
  // user's "current" jar.
  const [selectedJarId, setSelectedJarId] = useState<string | null>(
    activeJarId ?? jars[0]?.id ?? null,
  )
  const [selectedCookieId, setSelectedCookieId] = useState<string | null>(null)
  const [isCreatingJar, setIsCreatingJar] = useState(false)

  // If the currently-selected jar disappears (delete / workspace switch),
  // fall back to the first remaining one.
  useEffect(() => {
    if (selectedJarId && jars.some((j) => j.id === selectedJarId)) return
    setSelectedJarId(jars[0]?.id ?? null)
  }, [jars, selectedJarId])

  const selectedJar = jars.find((j) => j.id === selectedJarId) ?? null
  const selectedCookie =
    selectedJar?.cookies.find((c) => c.id === selectedCookieId) ?? null

  return (
    <ManagementModal
      width={selectedCookie ? 1160 : 780}
      onClose={onClose}
      title={<span className="text-[1rem] font-semibold text-fg">Cookies</span>}
    >
      {/* ── jar list (left, 240px) ── */}
      <div className="w-60 border-r border-border flex flex-col shrink-0 py-3 gap-y-1">
        {jars.map((jar) => (
          <JarRow
            key={jar.id}
            jar={jar}
            isSelected={selectedJarId === jar.id}
            isActive={activeJarId === jar.id}
            isDefault={jar.id === DEFAULT_JAR_ID}
            isOnly={jars.length === 1}
            onSelect={() => {
              setSelectedJarId(jar.id)
              setSelectedCookieId(null)
            }}
            onDeleted={() => {
              setSelectedJarId(jars.find((j) => j.id !== jar.id)?.id ?? null)
              setSelectedCookieId(null)
            }}
            workspaceId={workspaceId}
          />
        ))}

        {isCreatingJar && (
          <InlineNewJar
            workspaceId={workspaceId}
            onCreated={(id) => {
              setSelectedJarId(id)
              setSelectedCookieId(null)
              setIsCreatingJar(false)
            }}
            onCancel={() => setIsCreatingJar(false)}
            createJar={createJar}
          />
        )}

        <button
          type="button"
          onClick={() => setIsCreatingJar(true)}
          className="flex items-center gap-2 mx-2 mt-1 px-3 py-[6px] rounded-md cursor-pointer bg-transparent hover:bg-subtle outline-none transition-colors border-0"
        >
          <Glyph kind="plus" size={12} color="var(--base04)" />
          <span className="font-sans text-[0.929rem] text-muted">New Jar</span>
        </button>
      </div>

      {/* ── master cookie list (middle, flex) ── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {selectedJar ? (
          <CookieList
            jar={selectedJar}
            workspaceId={workspaceId}
            selectedCookieId={selectedCookieId}
            onSelect={setSelectedCookieId}
          />
        ) : (
          <EmptyPane text="Select a jar" />
        )}
      </div>

      {/* ── detail editor (right, 400px) — only mounts when a cookie is picked ── */}
      {selectedJar && selectedCookie && (
        <div className="w-[400px] shrink-0 border-l border-border bg-bg">
          <CookieEditor
            key={selectedCookie.id}
            cookie={selectedCookie}
            workspaceId={workspaceId}
            jarId={selectedJar.id}
            onClose={() => setSelectedCookieId(null)}
            onDeleted={() => setSelectedCookieId(null)}
          />
        </div>
      )}
    </ManagementModal>
  )
}

function EmptyPane({ text }: { text: string }) {
  return (
    <div className="h-full flex items-center justify-center text-muted/70 text-[0.893rem] px-6 text-center">
      {text}
    </div>
  )
}

function InlineNewJar({
  workspaceId,
  onCreated,
  onCancel,
  createJar,
}: {
  workspaceId: string
  onCreated: (id: string) => void
  onCancel: () => void
  createJar: (workspaceId: string, name: string) => Promise<{ id: string }>
}) {
  return (
    <InlineNewNavItem
      placeholder="Jar name"
      dotClassName="bg-accent"
      onCancel={onCancel}
      onCommit={async (name) => {
        const jar = await createJar(workspaceId, name).catch(() => null)
        if (!jar) return false
        onCreated(jar.id)
        return true
      }}
    />
  )
}
