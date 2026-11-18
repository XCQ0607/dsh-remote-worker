import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { useToast } from './toast'

export function useData<T>(path: string, every = 0) {
  const [data, setData] = useState<T | null>(null)
  const toast = useToast()
  const stopped = useRef(false)
  const reload = useCallback(() => {
    api<T>(path).then(d => { stopped.current = false; setData(d) }).catch(e => {
      if (e?.status === 401 || e?.status === 403) {
        stopped.current = true
        if (e?.status === 403) toast('e', String(e.message))
        return
      }
      toast('e', String(e.message))
    })
  }, [path, toast])
  useEffect(() => {
    stopped.current = false
    reload()
    if (!every) return
    const t = setInterval(() => { if (!document.hidden && !stopped.current) reload() }, every)
    return () => clearInterval(t)
  }, [reload, every])
  return [data, reload] as const
}
