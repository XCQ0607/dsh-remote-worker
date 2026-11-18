import { createContext, useContext } from 'react'

export const ToastCtx = createContext<(kind: 's' | 'e', text: string) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

