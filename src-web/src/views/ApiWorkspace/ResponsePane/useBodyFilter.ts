import { JSONPath } from "jsonpath-plus"
import { useEffect, useMemo, useRef, useState } from "react"
import type { BodyLang } from "./bodyLang"

export interface FilterResult {
  displayText: string
  error: string | null
  matchCount: number | null
}

function applyJsonPath(rawText: string, path: string): FilterResult {
  try {
    const json = JSON.parse(rawText) as object
    const matches = JSONPath({
      path: path.trim(),
      json,
      wrap: true,
    }) as unknown[]
    if (matches.length === 0) {
      return { displayText: "", error: null, matchCount: 0 }
    }
    // Unwrap single result so `$.foo` shows the value, not `[value]`.
    const out = matches.length === 1 ? matches[0] : matches
    return {
      displayText: JSON.stringify(out, null, 2),
      error: null,
      matchCount: matches.length,
    }
  } catch (e) {
    return {
      displayText: rawText,
      error: e instanceof Error ? e.message : "Invalid JSONPath",
      matchCount: null,
    }
  }
}

function applyXPath(rawText: string, path: string): FilterResult {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(rawText, "application/xml")
    if (doc.querySelector("parsererror")) {
      return {
        displayText: rawText,
        error: "Invalid XML document",
        matchCount: null,
      }
    }
    const result = document.evaluate(
      path.trim(),
      doc,
      null,
      XPathResult.ANY_TYPE,
      null,
    )

    // Scalar results (string / number / boolean expressions)
    if (result.resultType === XPathResult.STRING_TYPE) {
      return { displayText: result.stringValue, error: null, matchCount: 1 }
    }
    if (result.resultType === XPathResult.NUMBER_TYPE) {
      return {
        displayText: String(result.numberValue),
        error: null,
        matchCount: 1,
      }
    }
    if (result.resultType === XPathResult.BOOLEAN_TYPE) {
      return {
        displayText: String(result.booleanValue),
        error: null,
        matchCount: 1,
      }
    }

    // Node iterator — serialize each matched node back to XML
    const serializer = new XMLSerializer()
    const parts: string[] = []
    let node = result.iterateNext()
    while (node) {
      parts.push(serializer.serializeToString(node))
      node = result.iterateNext()
    }
    if (parts.length === 0) {
      return { displayText: "", error: null, matchCount: 0 }
    }
    return {
      displayText: parts.join("\n"),
      error: null,
      matchCount: parts.length,
    }
  } catch (e) {
    return {
      displayText: rawText,
      error: e instanceof Error ? e.message : "Invalid XPath",
      matchCount: null,
    }
  }
}

interface UseBodyFilterOptions {
  rawText: string
  lang: BodyLang
  open: boolean
}

export function useBodyFilter({ rawText, lang, open }: UseBodyFilterOptions) {
  const [filterQuery, setFilterQuery] = useState("")
  const filterInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) setFilterQuery("")
  }, [open])

  const filterResult = useMemo((): FilterResult => {
    if (!open || !filterQuery.trim()) {
      return { displayText: rawText, error: null, matchCount: null }
    }
    if (lang === "json") return applyJsonPath(rawText, filterQuery)
    if (lang === "xml") return applyXPath(rawText, filterQuery)
    return { displayText: rawText, error: null, matchCount: null }
  }, [rawText, lang, open, filterQuery])

  return { filterQuery, setFilterQuery, filterInputRef, filterResult }
}
