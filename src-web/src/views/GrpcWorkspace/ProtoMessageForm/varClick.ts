import { createContext, useContext } from "react"

export const VarClickContext = createContext<
  ((name: string) => void) | undefined
>(undefined)

export const useVarClick = () => useContext(VarClickContext)
