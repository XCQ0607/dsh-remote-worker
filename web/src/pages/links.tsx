import { useMemo, useState } from 'react'
import { Copy, RefreshCw, Search, XCircle } from 'lucide-react'
import { api, fmtDur } from '../lib/api'
import { useToast } from '../lib/toast'
import { useData } from '../lib/useData'
import { Confirm, type ConfirmState } from '../components/kit'
import './invites.css'

export function Links() {
  const [d, reload] = useData<any>('/api/v1/admin/links', 3000)
  const toast = useToast()
  const [q, setQ] = useState('')
  const [stage, setStage] = useState('all')
  const [sort, setSort] = useState<'age' | 'stage'>('age')
  const [sel, setSel] = useState<string[]>([])
  const [cfm, setCfm] = useState<ConfirmState>(null)
  const items: any[] = d?.items ?? []
  const stages = useMemo(() => Array.from(new Set(items.map(l => l.stage))), [items])
  const list = useMemo(() => items
    .filter(l => (stage === 'all' || l.stage === stage) && (!q || `${l.id} ${l.host} ${l.client}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => sort === 'age' ? a.ageMs - b.ageMs : String(a.stage).localeCompare(String(b.stage))), [items, q, stage, sort])
  const selSet = new Set(sel)
  const picked = list.filter(l => selSet.has(l.id))
  const allSel = list.length > 0 && picked.length === list.length
  const partSel = picked.length > 0 && !allSel
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast('s', '已复制') } catch { toast('e', '复制失败') } }
  const drop = (id: string) => setCfm({ title: '断开连接', body: `确定断开连接 ${id.slice(0, 8)} 吗？`, okText: '确认断开', onOk: async () => { try { await api(`/api/v1/admin/links/${id}`, { method: 'DELETE' }); toast('s', '已断开'); setSel(s => s.filter(x => x !== id)); reload() } catch (e: any) { toast('e', e.message) } } })
  const dropSel = () => {
    if (!picked.length) return
    setCfm({
      title: '批量断开连接', body: `确定断开选中的 ${picked.length} 个实时连接吗？`, okText: '确认断开',
      onOk: async () => {
        const rs = await Promise.allSettled(picked.map(l => api(`/api/v1/admin/links/${l.id}`, { method: 'DELETE' })))
        const bad = rs.filter(r => r.status === 'rejected').length
        toast(bad ? 'e' : 's', bad ? `${bad} 个断开失败` : `已断开 ${picked.length} 个连接`)
        setSel([]); reload()
      },
    })
  }
  const ready = items.filter(l => l.stage === 'ready').length
  return (<>
    <div className="iv-head"><div><h1>实时连接</h1><p>Host ⇄ Client 的逻辑连接 · 每 3 秒自动刷新</p></div>
      <div className="iv-acts"><button className="btn" onClick={reload}><RefreshCw size={15} />刷新</button></div></div>
    <div className="iv-stats">
      <div className="iv-stat"><b>{items.length}</b><span>活动连接</span></div>
      <div className="iv-stat"><b>{ready}</b><span>已就绪</span></div>
      <div className="iv-stat"><b>{items.length - ready}</b><span>协商中</span></div>
    </div>
    <div className="iv-bar">
      <div className="iv-search"><Search size={14} /><input placeholder="搜索连接 / Host / Client ID" value={q} onChange={e => setQ(e.target.value)} /></div>
      <button className={`chip ${stage === 'all' ? 'on active' : ''}`} onClick={() => setStage('all')}>全部</button>
      {stages.map(s => <button key={s} className={`chip ${stage === s ? 'on active' : ''}`} onClick={() => setStage(s)}>{s}</button>)}
      <button className="btn sm" onClick={() => setSort(sort === 'age' ? 'stage' : 'age')}>排序：{sort === 'age' ? '最新' : '阶段'}</button>
    </div>
    {list.length > 0 && <div className="iv-bar">
      <label><input type="checkbox" ref={el => { if (el) el.indeterminate = partSel }} checked={allSel} onChange={e => setSel(e.target.checked ? list.map(l => l.id) : [])} /><span>全选 ({list.length})</span></label>
    </div>}
    {!d ? <div className="iv-list">{[1, 2, 3].map(i => <div key={i} className="iv-skel" />)}</div>
      : !list.length ? <div className="iv-empty">{items.length ? '没有符合条件的连接' : '当前没有活动连接'}</div>
        : <div className="iv-list">{list.map(l => {
          const isSel = selSet.has(l.id)
          return (
            <div className={`iv-item ${isSel ? 'sel' : ''}`} key={l.id}>
              <input type="checkbox" checked={isSel} onChange={e => setSel(s => e.target.checked ? [...s, l.id] : s.filter(x => x !== l.id))} />
              <div className="main">
                <div className="t"><span className="mono">{l.id.slice(0, 8)}</span><span className={`badge ${l.stage === 'ready' ? 'ok' : ''}`}><i />{l.stage}</span>
                  {l.preferredTransports?.[0] && <span className="badge">{l.preferredTransports.join('/')}</span>}</div>
                <div className="m mono">Host {l.host.slice(0, 12)} → Client {l.client.slice(0, 12)} · 时长 {fmtDur(l.ageMs)}</div>
              </div>
              <div className="r">
                <button className="icon-btn" title="复制连接 ID" onClick={() => copy(l.id)}><Copy size={14} /></button>
                <button className="btn sm danger" onClick={() => drop(l.id)}><XCircle size={13} />断开</button>
              </div>
            </div>)
        })}</div>}
    {picked.length > 0 && <div className="iv-sel"><b>已选 {picked.length} 个</b><span className="sp" /><button className="btn sm danger" onClick={dropSel}><XCircle size={13} />批量断开</button><button className="btn sm" onClick={() => setSel([])}>取消</button></div>}
    <Confirm state={cfm} onClose={() => setCfm(null)} />
  </>)
}
