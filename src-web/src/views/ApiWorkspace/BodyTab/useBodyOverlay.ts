import { Prec } from "@codemirror/state"
import type { EditorView } from "@uiw/react-codemirror"
import { EditorView as CMEditorView, keymap } from "@uiw/react-codemirror"
import { useMemo, useRef, useState } from "react"
import type { AutocompleteItem } from "@/components/TemplateInput/Autocomplete"
import { buildItems } from "@/components/TemplateInput/Autocomplete"
import type { BoundTemplateFunction } from "@/plugins/types"
import {
  getSchemaCompletions,
  templateContext,
  wordContext,
} from "./overlayContext"
import { applySelection } from "./overlaySelection"

export interface BodyOverlayState {
  open: boolean
  items: AutocompleteItem[]
  selectedIndex: number
  anchorRect: DOMRect | null
  query: string
}

const CLOSED: BodyOverlayState = {
  open: false,
  items: [],
  selectedIndex: 0,
  anchorRect: null,
  query: "",
}

export function useBodyOverlay(
  varKeys: string[],
  fns: BoundTemplateFunction[],
  onPickFunc?: (
    fnName: string,
    args: Record<string, string>,
    from: number,
    to: number,
  ) => void,
) {
  const editorViewRef = useRef<EditorView | null>(null)
  const [state, setState] = useState<BodyOverlayState>(CLOSED)
  const onPickFuncRef = useRef(onPickFunc)
  onPickFuncRef.current = onPickFunc

  // Stable refs for use inside CM extensions (no stale closures).
  const stateRef = useRef(state)
  stateRef.current = state
  const varKeysRef = useRef(varKeys)
  varKeysRef.current = varKeys
  const fnsRef = useRef(fns)
  fnsRef.current = fns
  const partialStartRef = useRef(0)

  function closeFn() {
    setState(CLOSED)
  }
  const closeRef = useRef(closeFn)
  closeRef.current = closeFn

  function present(
    items: AutocompleteItem[],
    partialStart: number,
    query: string,
    view: EditorView,
  ) {
    if (items.length === 0) {
      closeFn()
      return
    }
    const cursor = view.state.selection.main.head
    const coords = view.coordsAtPos(cursor)
    setState((prev) => ({
      open: true,
      items,
      selectedIndex: 0,
      anchorRect: coords
        ? new DOMRect(coords.left, coords.bottom, 0, 0)
        : prev.anchorRect,
      query,
    }))
    partialStartRef.current = partialStart
  }

  function openAt(
    query: string,
    partialStart: number,
    nsFilter: string | null,
    view: EditorView,
  ) {
    present(
      buildItems(query, varKeysRef.current, fnsRef.current, nsFilter),
      partialStart,
      query,
      view,
    )
  }
  const openAtRef = useRef(openAt)
  openAtRef.current = openAt

  function evaluate(view: EditorView, explicit: boolean) {
    const cursor = view.state.selection.main.head
    const before = view.state.sliceDoc(0, cursor)

    const tmpl = templateContext(before)
    if (tmpl) {
      openAt(tmpl.query, tmpl.start, tmpl.ns, view)
      return
    }
    const schema = getSchemaCompletions(view, cursor, explicit)
    if (schema) {
      present(schema.items, schema.from, schema.query, view)
      return
    }
    const word = wordContext(before, cursor)
    if (word) {
      openAt(word.query, word.start, word.ns, view)
      return
    }
    if (explicit) openAt("", cursor, null, view)
    else closeFn()
  }
  const evaluateRef = useRef(evaluate)
  evaluateRef.current = evaluate

  function selectItemInner(item: AutocompleteItem, view: EditorView | null) {
    applySelection(item, view, {
      partialStart: partialStartRef.current,
      close: closeRef.current,
      openAt: openAtRef.current,
      onPickFunc: onPickFuncRef.current,
    })
  }
  const selectItemRef = useRef(selectItemInner)
  selectItemRef.current = selectItemInner

  const updateListenerExt = useMemo(
    () =>
      CMEditorView.updateListener.of((update) => {
        if (update.docChanged) {
          evaluateRef.current(update.view, false)
          return
        }
        if (!update.selectionSet) return
        const cursor = update.state.selection.main.head
        const tmpl = templateContext(update.state.sliceDoc(0, cursor))
        if (tmpl)
          openAtRef.current(tmpl.query, tmpl.start, tmpl.ns, update.view)
        else closeRef.current()
      }),
    [],
  )

  const keymapExt = useMemo(() => {
    const nav = (delta: number) => () => {
      if (!stateRef.current.open) return false
      setState((s) => ({
        ...s,
        selectedIndex: Math.min(
          Math.max(s.selectedIndex + delta, 0),
          s.items.length - 1,
        ),
      }))
      return true
    }
    const pick = () => {
      if (!stateRef.current.open) return false
      const item = stateRef.current.items[stateRef.current.selectedIndex]
      if (item) selectItemRef.current(item, editorViewRef.current)
      return true
    }
    return Prec.highest(
      keymap.of([
        { key: "ArrowDown", run: nav(1) },
        { key: "ArrowUp", run: nav(-1) },
        { key: "Tab", run: pick },
        { key: "Enter", run: pick },
        {
          key: "Escape",
          run: () => {
            if (!stateRef.current.open) return false
            closeRef.current()
            return true
          },
        },
        {
          key: "Ctrl-Space",
          run: (view) => {
            evaluateRef.current(view, true)
            return true
          },
        },
      ]),
    )
  }, [])

  function selectItem(item: AutocompleteItem) {
    selectItemRef.current(item, editorViewRef.current)
  }

  return {
    editorViewRef,
    overlayState: state,
    updateListenerExt,
    keymapExt,
    selectItem,
    close: closeFn,
  }
}
