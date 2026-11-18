import { useMemo, useState } from 'react'
import { Ban, Copy, Cpu, Info, Monitor, Pencil, Plug, Plus, Search, Unplug } from 'lucide-react'
import { api, fmtAgo } from '../lib/api'
import { useToast } from '../lib/toast'
import { useData } from '../lib/useData'
import { Modal } from '../components/ui'
import { Bdg, CopyBtn, Empty, Head, RefreshBtn, Skeleton, StatCard, useCopy } from '../components/kit'

type Sort = 'recent' | 'name' | 'online'
const sortBy = (a: any, b: any, s: Sort) => s === 'name' ? String(a.name || a.deviceId).localeCompare(String(b.name || b.deviceId)) : s === 'online' ? Number(b.online) - Number(a.online) || b.lastSeenAt - a.lastSeenAt : b.lastSeenAt - a.lastSeenAt

function useFilter(items: any[], extra: (x: any) => string) {
  const [q, setQ] = useState(''), [only, setOnly] = useState<'all' | 'on' | 'off'>('all'), [role, setRole] = useState<'all' | 'host' | 'client'>('all'), [sort, setSort] = useState<Sort>('recent')
  const list = useMemo(() => items.filter(x => (only === 'all' || (only === 'on') === !!x.online) && (role === 'all' || x.role === role)
    && (!q || `${x.name ?? ''} ${x.deviceId} ${extra(x)}`.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => sortBy(a, b, sort)), [items, q, only, role, sort])
  const bar = (
    <div className="pg-bar">
      <div className="search-box"><Search size={14} /><input placeholder="搜索设备名 / ID / 账号" value={q} onChange={e => setQ(e.target.value)} /></div>
      <div className="seg">{(['all', 'on', 'off'] as const).map(k => <button key={k} className={`chip ${only === k ? 'on' : ''}`} onClick={() => setOnly(k)}>{k === 'all' ? '全部' : k === 'on' ? '在线' : '离线'}</button>)}</div>
      <div className="seg">{(['all', 'host', 'client'] as const).map(k => <button key={k} className={`chip ${role === k ? 'on' : ''}`} onClick={() => setRole(k)}>{k === 'all' ? '全角色' : k === 'host' ? 'Host' : 'Client'}</button>)}</div>
      <select value={sort} onChange={e => setSort(e.target.value as Sort)}><option value="recent">最近在线</option><option value="online">在线优先</option><option value="name">按名称</option></select>
    </div>)
  return { list, bar }
}
const Stats = ({ items }: { items: any[] }) => (
  <div className="pg-stats">
    <StatCard icon={<Monitor size={18} />} label="设备总数" value={items.length} />
    <StatCard icon={<Plug size={18} />} label="在线" value={items.filter(x => x.online).length} />
    <StatCard icon={<Cpu size={18} />} label="Host" value={items.filter(x => x.role === 'host').length} />
  </div>)
const Id = ({ id }: { id: string }) => <span className="mono">{id}<CopyBtn text={id} what="设备 ID" /></span>

export function MyDevices() {
  const [d, reload] = useData<any>('/api/v1/account/devices', 8000)
  const toast = useToast()
  const copy = useCopy()
  const [ren, setRen] = useState<{ id: string; name: string } | null>(null)
  const [revId, setRevId] = useState<string | null>(null)
  const [pairCode, setPairCode] = useState<{ code: string; expiresAt: number } | null>(null)
  const [pairBusy, setPairBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const { list, bar } = useFilter(d?.items ?? [], () => '')
  const saveRename = async () => {
    if (!ren || !ren.name.trim() || busy) return
    setBusy(true)
    try { await api(`/api/v1/devices/${encodeURIComponent(ren.id)}/name`, { body: { name: ren.name.trim() } }); toast('s', '已重命名'); setRen(null); reload() } catch (e: any) { toast('e', e.message) } finally { setBusy(false) }
  }
  const doRevoke = async () => {
    if (!revId || busy) return
    setBusy(true)
    try { await api(`/api/v1/account/devices/${encodeURIComponent(revId)}`, { method: 'DELETE' }); toast('s', '已吊销'); setRevId(null); reload() } catch (e: any) { toast('e', e.message) } finally { setBusy(false) }
  }
  const startPair = async () => {
    setPairBusy(true)
    try { const r = await api('/api/v1/account/host-registration-codes', { method: 'POST', body: {} }); setPairCode(r) }
    catch (e: any) { toast('e', e.message) } finally { setPairBusy(false) }
  }
  return (<>
    <Head title="我的设备" sub={d ? <>接入地址: {d.serverUrl}</> : '已注册到此账号的 Host 与 Client'}>
      <button className="btn pri" disabled={pairBusy} onClick={startPair}><Plus size={15} />添加主机</button>
      {d?.serverUrl && <button className="btn" onClick={() => copy(d.serverUrl, '接入地址')}><Copy size={14} />接入地址</button>}
      <RefreshBtn onClick={reload} auto="8 秒自动刷新" />
    </Head>
    {!d ? <Skeleton /> : <>
      <Stats items={d.items} />{bar}
      <div className="pg-list">
        {list.map((x: any) => <div key={x.deviceId} className="pg-item">
          <div className="main"><div className="t">{x.name || x.deviceId}<Bdg kind={x.online ? 'ok' : ''}>{x.online ? '在线' : '离线'}</Bdg><Bdg>{x.role}</Bdg></div>
            <div className="m"><Id id={x.deviceId} /><span>{x.platform ?? '-'}</span><span>{fmtAgo(x.lastSeenAt)}</span></div></div>
          <div className="acts"><button className="btn sm" onClick={() => setRen({ id: x.deviceId, name: x.name || '' })}><Pencil size={13} />改名</button>
            <button className="btn sm danger" onClick={() => setRevId(x.deviceId)}><Ban size={13} />吊销</button></div>
        </div>)}
        {!list.length && <Empty>{d.items.length ? '没有匹配的设备' : '暂无设备，点击右上角「添加主机」生成配对码'}</Empty>}
      </div></>}
    {ren && <Modal title="重命名设备" onClose={() => setRen(null)}>
      <div className="field"><label>设备名称</label><input autoFocus maxLength={64} value={ren.name} onChange={e => setRen({ ...ren, name: e.target.value })} onKeyDown={e => e.key === 'Enter' && saveRename()} /></div>
      <div className="row right"><button className="btn" onClick={() => setRen(null)}>取消</button><button className="btn pri" disabled={busy || !ren.name.trim()} onClick={saveRename}>{busy ? '保存中…' : '保存'}</button></div>
    </Modal>}
    {revId && <Modal title="确认吊销设备" onClose={() => setRevId(null)}>
      <p style={{ marginTop: 0 }}>吊销后设备 <code className="mono">{revId}</code> 将立即下线，需重新配对登录。</p>
      <div className="row right"><button className="btn" onClick={() => setRevId(null)}>取消</button><button className="btn danger" disabled={busy} onClick={doRevoke}>{busy ? '吊销中…' : '确认吊销'}</button></div>
    </Modal>}
    {pairCode && <Modal title="添加主机 · 快速配对" onClose={() => setPairCode(null)}>
      <div className="field"><label>接入地址</label><div className="row"><input readOnly value={d?.serverUrl ?? ''} /><button className="btn sm" onClick={() => copy(d?.serverUrl ?? '', '接入地址')}><Copy size={13} />复制</button></div></div>
      <div className="field"><label>主机匹配码（10 分钟内有效）</label>
        <button className="pf-code-v mono" style={{ width: '100%' }} onClick={() => copy(pairCode.code, '匹配码')}>{pairCode.code}</button>
        <div className="hint">点击上方匹配码即可复制，在主机端选择配对输入即可。</div></div>
      <div className="row right"><button className="btn pri" onClick={() => setPairCode(null)}>完成</button></div>
    </Modal>}
  </>)
}

export function AllDevices() {
  const [d, reload] = useData<any>('/api/v1/admin/devices', 6000)
  const toast = useToast()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [acc, setAcc] = useState('')
  const [detail, setDetail] = useState<any | null>(null)
  const [revIds, setRevIds] = useState<string[] | null>(null)
  const [discIds, setDiscIds] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const all: any[] = d?.items ?? []
  const accounts = useMemo(() => [...new Set(all.map(x => x.account))].sort(), [all])
  const { list: l0, bar } = useFilter(all, x => x.account)
  const list = acc ? l0.filter(x => x.account === acc) : l0
  const run = async (ids: string[], a: 'disconnect' | 'revoke') => {
    if (!ids.length || busy) return
    setBusy(true)
    try {
      const rs = await Promise.allSettled(ids.map(id => api(`/api/v1/admin/devices/${encodeURIComponent(id)}/${a}`, { body: {} })))
      const bad = rs.filter(r => r.status === 'rejected').length
      toast(bad ? 'e' : 's', bad ? `${bad} 台失败` : `已执行 ${ids.length} 台`); setSel(new Set()); setRevIds(null); setDiscIds(null); setDetail(null); reload()
    } finally { setBusy(false) }
  }
  const tog = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const ids = [...sel].filter(id => all.some(x => x.deviceId === id))
  const visPicked = list.filter(x => sel.has(x.deviceId))
  const allSel = list.length > 0 && visPicked.length === list.length
  const partSel = visPicked.length > 0 && !allSel
  return (<>
    <Head title="全部设备" sub="跨账号查看、详情排查、踢下线、吊销（支持批量）"><RefreshBtn onClick={reload} auto="6 秒自动刷新" /></Head>
    {!d ? <Skeleton /> : <>
      <Stats items={all} />
      {bar}
      <div className="pg-bar">
        <select value={acc} onChange={e => setAcc(e.target.value)}><option value="">全部账号</option>{accounts.map(a => <option key={a} value={a}>{a}</option>)}</select>
        {list.length > 0 && <label><input type="checkbox" ref={el => { if (el) el.indeterminate = partSel }} checked={allSel} onChange={e => setSel(e.target.checked ? new Set(list.map(x => x.deviceId)) : new Set())} /><span>全选 ({list.length})</span></label>}
      </div>
      <div className="pg-list">
        {list.map((x: any) => <div key={x.deviceId} className={`pg-item ${sel.has(x.deviceId) ? 'sel' : ''}`}>
          <input type="checkbox" checked={sel.has(x.deviceId)} onChange={() => tog(x.deviceId)} />
          <div className="main"><div className="t">{x.name || '-'}<Bdg kind={x.online ? 'ok' : ''}>{x.online ? '在线' : '离线'}</Bdg><Bdg>{x.role}</Bdg>{x.pairingRestricted && <Bdg kind="warn">仅被控</Bdg>}</div>
            <div className="m"><Id id={x.deviceId} /><span>{x.account}<CopyBtn text={x.account} what="账号" /></span><span>v{x.clientVersion ?? '-'}</span><span>{fmtAgo(x.lastSeenAt)}</span></div></div>
          <div className="acts">
            <button className="btn sm" onClick={() => setDetail(x)}><Info size={13} />详情</button>
            {x.online && <button className="btn sm" disabled={busy} onClick={() => run([x.deviceId], 'disconnect')}><Unplug size={13} />踢下线</button>}
            <button className="btn sm danger" disabled={busy} onClick={() => setRevIds([x.deviceId])}><Ban size={13} />吊销</button>
          </div>
        </div>)}
        {!list.length && <Empty>{all.length ? '没有匹配的设备' : '暂无设备'}</Empty>}
      </div>
      {ids.length > 0 && <div className="pg-bulk"><b>已选 {ids.length} 台</b><span className="sp" />
        <button className="btn sm" disabled={busy} onClick={() => setDiscIds(ids)}><Unplug size={13} />批量踢下线</button>
        <button className="btn sm danger" disabled={busy} onClick={() => setRevIds(ids)}><Ban size={13} />批量吊销</button>
        <button className="btn sm" onClick={() => setSel(new Set())}>取消</button></div>}
    </>}
    {detail && <Modal title={`设备详情 · ${detail.name || detail.deviceId}`} onClose={() => setDetail(null)}>
      <div className="pg-kv"><span>设备 ID</span><span className="mono">{detail.deviceId}<CopyBtn text={detail.deviceId} what="设备 ID" /></span></div>
      <div className="pg-kv"><span>所属账号</span><span className="mono">{detail.account}<CopyBtn text={detail.account} what="账号" /></span></div>
      <div className="pg-kv"><span>角色 / 平台</span><span>{detail.role} · {detail.platform ?? '-'}</span></div>
      <div className="pg-kv"><span>客户端版本</span><span className="mono">{detail.clientVersion ?? '-'}</span></div>
      <div className="pg-kv"><span>当前状态</span><span>{detail.online ? '在线' : '离线'}</span></div>
      <div className="pg-kv"><span>最近活跃</span><span>{detail.lastSeenAt ? new Date(detail.lastSeenAt).toLocaleString() : '从未'}</span></div>
      <div className="row right" style={{ marginTop: 14 }}>
        {detail.online && <button className="btn" disabled={busy} onClick={() => run([detail.deviceId], 'disconnect')}><Unplug size={14} />踢下线</button>}
        <button className="btn danger" disabled={busy} onClick={() => setRevIds([detail.deviceId])}><Ban size={14} />吊销</button>
      </div>
    </Modal>}
    {discIds && <Modal title="确认批量踢下线" onClose={() => setDiscIds(null)}>
      <p style={{ marginTop: 0 }}>确定断开选中的 {discIds.length} 台设备的当前连接吗？设备稍后可自动重连。</p>
      <div className="row right"><button className="btn" onClick={() => setDiscIds(null)}>取消</button><button className="btn pri" disabled={busy} onClick={() => run(discIds, 'disconnect')}>{busy ? '处理中…' : '确认踢下线'}</button></div>
    </Modal>}
    {revIds && <Modal title="确认吊销设备" onClose={() => setRevIds(null)}>
      <p style={{ marginTop: 0 }}>确定吊销选中的 {revIds.length} 台设备吗？吊销后需重新配对注册。</p>
      <div className="row right"><button className="btn" onClick={() => setRevIds(null)}>取消</button><button className="btn danger" disabled={busy} onClick={() => run(revIds, 'revoke')}>{busy ? '吊销中…' : '确认吊销'}</button></div>
    </Modal>}
  </>)
}
