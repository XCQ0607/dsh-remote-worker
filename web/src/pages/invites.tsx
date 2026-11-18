import { useMemo, useState } from 'react'
import { Copy, Download, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { useToast } from '../lib/toast'
import { useData } from '../lib/useData'
import { Confirm, type ConfirmState } from '../components/kit'
import './invites.css'

type St = 'active' | 'used' | 'expired'
const LBL: Record<St, string> = { active: '可用', used: '已用完', expired: '已过期' }

export function InvitesPage() {
  const [d, reload] = useData<any>('/api/v1/admin/invites', 15000)
  const toast = useToast()
  const [show, setShow] = useState(false)
  const [code, setCode] = useState('')
  const [count, setCount] = useState('1')
  const [maxUses, setMaxUses] = useState('1')
  const [expiresHours, setExpiresHours] = useState('168')
  const [note, setNote] = useState('')
  const [sel, setSel] = useState<string[]>([])
  const [flt, setFlt] = useState<'all' | St>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'new' | 'uses' | 'exp'>('new')
  const [open, setOpen] = useState<string | null>(null)
  const [cfm, setCfm] = useState<ConfirmState>(null)
  const [busy, setBusy] = useState(false)
  const now = Date.now()
  const st = (x: any): St => x.uses >= x.maxUses ? 'used' : (x.expiresAt > 0 && x.expiresAt <= now) ? 'expired' : 'active'
  const all: any[] = d?.items ?? []
  const cnt = useMemo(() => { const c = { all: all.length, active: 0, used: 0, expired: 0 }; all.forEach(x => { c[st(x)]++ }); return c }, [all]) // eslint-disable-line
  const items = useMemo(() => all
    .filter(x => (flt === 'all' || st(x) === flt) && (!q || `${x.code} ${x.note ?? ''} ${(x.usedBy ?? []).map((u: any) => u.email).join(' ')}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => sort === 'uses' ? b.uses - a.uses : sort === 'exp' ? (a.expiresAt || 1e15) - (b.expiresAt || 1e15) : (b.createdAt ?? 0) - (a.createdAt ?? 0)), [all, flt, q, sort]) // eslint-disable-line
  const selSet = new Set(sel)
  const picked = items.filter(x => selSet.has(x.code))
  const allSel = items.length > 0 && picked.length === items.length
  const partSel = picked.length > 0 && !allSel
  const copyText = async (t: string, n: number) => {
    try { await navigator.clipboard.writeText(t); toast('s', `已复制 ${n} 个邀请码`) } catch { toast('e', '复制失败') }
  }
  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const n = Math.max(1, Math.min(100, Number(count) || 1))
      const r = await api('/api/v1/admin/invites', { method: 'POST', body: {
        ...(n === 1 && code.trim() ? { code: code.trim() } : {}), count: n, maxUses: Math.max(1, Number(maxUses) || 1),
        ...(Number(expiresHours) > 0 ? { expiresHours: Number(expiresHours) } : {}), ...(note.trim() ? { note: note.trim() } : {}) } })
      const created: any[] = r.items ?? r.codes ?? (r.code ? [r.code] : [])
      const txt = created.map((c: any) => c.code ?? c).join('\n')
      if (txt) navigator.clipboard.writeText(txt).catch(() => {})
      toast('s', n > 1 ? `已批量生成 ${r.count ?? created.length} 个邀请码（已复制）` : `已生成邀请码: ${r.code}（已复制）`)
      setCode(''); setNote(''); reload()
    } catch (err: any) { toast('e', err.message) } finally { setBusy(false) }
  }
  const del = (c: string) => setCfm({ title: '删除邀请码', body: `确定删除邀请码 ${c} 吗？`, okText: '确认删除', onOk: async () => { try { await api(`/api/v1/admin/invites/${encodeURIComponent(c)}`, { method: 'DELETE' }); toast('s', '已删除'); setSel(s => s.filter(x => x !== c)); reload() } catch (err: any) { toast('e', err.message) } } })
  const batchDel = (expired = false) => {
    const targets = expired ? [] : sel.filter(c => all.some(x => x.code === c))
    if (!expired && !targets.length) return
    setCfm({
      title: expired ? '清理失效邀请码' : '批量删除邀请码',
      body: expired ? '确定清理所有已过期或已用完的邀请码吗？' : `确定删除选中的 ${targets.length} 个邀请码吗？`,
      okText: '确认删除',
      onOk: async () => {
        try {
          const r = await api('/api/v1/admin/invites/batch-delete', { method: 'POST', body: expired ? { expired: true } : { codes: targets } })
          toast('s', `已清理 ${r.removed} 个邀请码`); if (!expired) setSel([]); reload()
        } catch (err: any) { toast('e', err.message) }
      },
    })
  }
  const exportInvites = (fmt: 'csv' | 'txt' | 'json') => {
    const list = picked.length ? picked : items
    if (!list.length) { toast('e', '暂无可导出的邀请码'); return }
    const content = fmt === 'txt' ? list.map(x => x.code).join('\n')
      : fmt === 'json' ? JSON.stringify(list.map(x => ({ ...x, status: LBL[st(x)] })), null, 2)
      : ['code,status,uses,maxUses,usedBy,expiresAt,note', ...list.map(x => [x.code, LBL[st(x)], x.uses, x.maxUses,
          (x.usedBy ?? []).map((u: any) => `${u.email}(${new Date(u.at).toISOString()})`).join('; '),
          x.expiresAt ? new Date(x.expiresAt).toISOString() : 'never', x.note ?? ''].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
    a.download = `dsh-invites-${Date.now()}.${fmt}`; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const totalUses = all.reduce((s, x) => s + (x.uses || 0), 0)
  const activeSel = picked.length > 0 ? picked : items.filter(x => st(x) === 'active')
  return (<>
    <div className="iv-head"><div><h1>邀请码管理</h1><p>批量生成、搜索筛选、使用明细与导出 · 每 15 秒自动刷新</p></div>
      <div className="iv-acts">
        <button className="btn" onClick={reload}><RefreshCw size={15} />刷新</button>
        <button className="btn pri" onClick={() => setShow(!show)}><Plus size={15} />生成邀请码</button>
      </div></div>
    <div className="iv-stats">
      <div className="iv-stat"><b>{cnt.all}</b><span>总数</span></div>
      <div className="iv-stat"><b>{cnt.active}</b><span>可用</span></div>
      <div className="iv-stat"><b>{cnt.used}</b><span>已用完</span></div>
      <div className="iv-stat"><b>{cnt.expired}</b><span>已过期</span></div>
      <div className="iv-stat"><b>{totalUses}</b><span>累计使用</span></div>
    </div>
    {show && <form className="iv-form" onSubmit={create}>
      <div className="g">
        <label className="field"><span>自定义邀请码（仅单个）</span><input value={code} onChange={e => setCode(e.target.value)} placeholder="留空自动生成" disabled={Number(count) > 1} /></label>
        <label className="field"><span>生成数量（1-100）</span><input type="number" min={1} max={100} value={count} onChange={e => setCount(e.target.value)} /></label>
        <label className="field"><span>可用次数</span><input type="number" min={1} value={maxUses} onChange={e => setMaxUses(e.target.value)} /></label>
        <label className="field"><span>有效小时（0 永久）</span><input type="number" min={0} value={expiresHours} onChange={e => setExpiresHours(e.target.value)} /></label>
        <label className="field"><span>备注</span><input value={note} onChange={e => setNote(e.target.value)} placeholder="可选备注" /></label>
      </div>
      <div style={{ marginTop: 12 }}><button className="btn pri" type="submit" disabled={busy}>{busy ? '生成中…' : (Number(count) > 1 ? `批量生成 ${count} 个` : '生成邀请码')}</button></div>
    </form>}
    <div className="iv-bar">
      <div className="iv-search"><Search size={14} /><input placeholder="搜索邀请码 / 备注 / 用户邮箱" value={q} onChange={e => setQ(e.target.value)} /></div>
      {(['all', 'active', 'used', 'expired'] as const).map(k => <button key={k} className={`chip ${flt === k ? 'on active' : ''}`} onClick={() => { setFlt(k); setSel([]) }}>{k === 'all' ? '全部' : LBL[k]} {cnt[k]}</button>)}
      <button className="btn sm" onClick={() => setSort(sort === 'new' ? 'uses' : sort === 'uses' ? 'exp' : 'new')}>排序：{sort === 'new' ? '最新' : sort === 'uses' ? '使用次数' : '到期时间'}</button>
    </div>
    <div className="iv-bar">
      <label><input type="checkbox" ref={el => { if (el) el.indeterminate = partSel }} checked={allSel} onChange={e => setSel(e.target.checked ? items.map(x => x.code) : [])} /><span>全选</span></label>
      <button className="btn sm" onClick={() => activeSel.length ? copyText(activeSel.map(x => x.code).join('\n'), activeSel.length) : toast('e', '没有可复制的邀请码')}><Copy size={13} />复制{picked.length ? '选中' : '可用'}</button>
      <button className="btn sm" onClick={() => exportInvites('csv')}><Download size={13} />CSV</button>
      <button className="btn sm" onClick={() => exportInvites('txt')}>TXT</button>
      <button className="btn sm" onClick={() => exportInvites('json')}>JSON</button>
      <button className="btn sm danger" onClick={() => batchDel(true)}><Trash2 size={13} />清理失效</button>
    </div>
    {!d ? <div className="iv-list">{[1, 2, 3].map(i => <div key={i} className="iv-skel" />)}</div>
      : !items.length ? <div className="iv-empty">{all.length ? '暂无符合条件的邀请码' : '还没有邀请码，点击右上角“生成邀请码”'}</div>
      : <div className="iv-list">{items.map(x => {
        const s = st(x), ub: any[] = x.usedBy ?? [], isSel = selSet.has(x.code)
        return (<div key={x.code} className={`iv-item ${isSel ? 'sel' : ''}`} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <div className="row-top">
            <input type="checkbox" checked={isSel} onChange={e => setSel(v => e.target.checked ? [...v, x.code] : v.filter(k => k !== x.code))} />
            <div className="main">
              <div className="t"><span className="mono">{x.code}</span><span className={`badge ${s === 'active' ? 'ok' : s === 'expired' ? 'bad' : ''}`}><i />{LBL[s]}</span></div>
              <div className="m">已用 {x.uses}/{x.maxUses} · {x.expiresAt ? `到期 ${new Date(x.expiresAt).toLocaleString()}` : '永久有效'}{x.note ? ` · ${x.note}` : ''}</div>
              <div className="iv-prog"><i style={{ width: `${Math.min(100, (x.uses / x.maxUses) * 100)}%` }} /></div>
            </div>
            <div className="r">
              {ub.length > 0 && <button className="btn sm" onClick={() => setOpen(open === x.code ? null : x.code)}>{ub[0].email}{ub.length > 1 ? ` +${ub.length - 1}` : ''}</button>}
              <button className="icon-btn" title="复制" onClick={() => copyText(x.code, 1)}><Copy size={14} /></button>
              <button className="icon-btn" title="删除" onClick={() => del(x.code)}><Trash2 size={14} /></button>
            </div>
          </div>
          {open === x.code && <ul className="m" style={{ margin: '6px 0 0', paddingLeft: 32 }}>{ub.map((u, i) => <li key={i} className="mono">{u.email} · {new Date(u.at).toLocaleString()}</li>)}</ul>}
        </div>)
      })}</div>}
    {picked.length > 0 && <div className="iv-sel"><b>已选 {picked.length} 个</b><span className="sp" />
      <button className="btn sm" onClick={() => copyText(picked.map(x => x.code).join('\n'), picked.length)}><Copy size={13} />复制</button>
      <button className="btn sm danger" onClick={() => batchDel(false)}><Trash2 size={13} />删除</button>
      <button className="btn sm" onClick={() => setSel([])}>取消</button></div>}
    <Confirm state={cfm} onClose={() => setCfm(null)} />
  </>)
}
