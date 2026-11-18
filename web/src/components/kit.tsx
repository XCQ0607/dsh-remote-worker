import { useEffect, useState, type ReactNode } from 'react'
import { Copy, RefreshCw } from 'lucide-react'
import { useToast } from '../lib/toast'
import { Modal } from './ui'
import './kit.css'

export const Head = ({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) => (
  <div className="pg-head"><div><h1>{title}</h1>{sub && <p className="sub">{sub}</p>}</div>{children && <div className="pg-acts">{children}</div>}</div>
)
export const Bdg = ({ kind = '', children }: { kind?: 'ok' | 'bad' | 'warn' | ''; children: ReactNode }) => <span className={`badge ${kind}`}><i />{children}</span>
export const StatCard = ({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) => (
  <div className="pg-stat"><div className="ic">{icon}</div><div><b>{value}</b><span>{label}</span></div></div>
)
export function useCopy() {
  const toast = useToast()
  return async (text: string, what = '内容') => { try { await navigator.clipboard.writeText(text); toast('s', `已复制${what}`) } catch { toast('e', '复制失败') } }
}
export function CopyBtn({ text, what }: { text: string; what?: string }) {
  const copy = useCopy()
  return <button className="pg-cp" title="复制" onClick={e => { e.stopPropagation(); copy(text, what) }}><Copy size={13} /></button>
}
export const Skeleton = ({ n = 4 }: { n?: number }) => <div className="pg-list">{Array.from({ length: n }, (_, i) => <div key={i} className="pg-sk" />)}</div>
export const Empty = ({ children }: { children: ReactNode }) => <div className="pg-empty">{children}</div>
export function RefreshBtn({ onClick, auto }: { onClick: () => void; auto?: string }) {
  const [spin, setSpin] = useState(false)
  useEffect(() => { if (!spin) return; const t = setTimeout(() => setSpin(false), 600); return () => clearTimeout(t) }, [spin])
  return <>{auto && <span className="pg-live"><i />{auto}</span>}<button className="btn" onClick={() => { setSpin(true); onClick() }}><RefreshCw size={15} className={spin ? 'spin' : ''} />刷新</button></>
}
export type ConfirmState = { title: string; body: string; danger?: boolean; okText?: string; onOk: () => void | Promise<void> } | null
export function Confirm({ state, onClose }: { state: ConfirmState; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  if (!state) return null
  const go = async () => { setBusy(true); try { await state.onOk(); onClose() } finally { setBusy(false) } }
  return <Modal title={state.title} onClose={onClose}>
    <p style={{ marginTop: 0 }}>{state.body}</p>
    <div className="row right"><button className="btn" onClick={onClose}>取消</button>
      <button className={`btn ${state.danger !== false ? 'danger' : 'pri'}`} disabled={busy} onClick={go}>{busy ? '处理中…' : (state.okText ?? '确认')}</button></div>
  </Modal>
}