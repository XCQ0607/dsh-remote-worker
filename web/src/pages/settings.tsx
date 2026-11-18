import { useEffect, useMemo, useState } from 'react'
import { Cloud, Copy, Network, Plus, RotateCcw, Save, Search, Shield, SlidersHorizontal, Trash2, Wifi, Zap } from 'lucide-react'
import { api } from '../lib/api'
import { useToast } from '../lib/toast'
import { useData } from '../lib/useData'
import { Confirm, useCopy, type ConfirmState } from '../components/kit'
import './settings.css'

type F = { key: string; label: string; hint: string; type: 'num' | 'bool' | 'text'; min?: number; max?: number }
const GROUPS: { id: string; title: string; icon: any; fields: F[] }[] = [
  { id: 'base', title: '基础', icon: SlidersHorizontal, fields: [
    { key: 'siteName', label: '站点名称', hint: '显示在后台标题', type: 'text' },
    { key: 'sessionHours', label: '后台登录有效期(小时)', hint: '1–720', type: 'num', min: 1, max: 720 }] },
  { id: 'p2p', title: 'P2P / STUN / TURN', icon: Network, fields: [
    { key: 'p2pEnabled', label: '打开 P2P', hint: '允许设备间协商 WebRTC 直连；关闭后仅走 TURN / Relay', type: 'bool' },
    { key: 'stunEnabled', label: '打开 STUN', hint: '用于 NAT 打洞，关闭后不下发任何 STUN', type: 'bool' },
    { key: 'maxEnabledStun', label: 'STUN 同时启用上限', hint: '1–16(默认 6)。过多或不可达会拖慢 ICE', type: 'num', min: 1, max: 16 },
    { key: 'turnEnabled', label: '启用 TURN', hint: 'P2P 失败时签发 Cloudflare TURN 凭据', type: 'bool' },
    { key: 'turnTtlSeconds', label: 'TURN 凭据有效期(秒)', hint: '60–3600', type: 'num', min: 60, max: 3600 }] },
  { id: 'conn', title: '连接与心跳', icon: Zap, fields: [
    { key: 'heartbeatMs', label: '心跳间隔(ms)', hint: '5000–120000', type: 'num', min: 5000, max: 120000 },
    { key: 'heartbeatDisconnectMs', label: '心跳断线阈值(ms)', hint: '15000–600000 且需 ≥ 2×心跳', type: 'num', min: 15000, max: 600000 },
    { key: 'helloTimeoutMs', label: 'Hello 握手超时(ms)', hint: '1000–60000，连接后必须在此时间内认证', type: 'num', min: 1000, max: 60000 }] },
  { id: 'limit', title: '限额', icon: Shield, fields: [
    { key: 'maxFramesPerSec', label: '单连接每秒帧数上限', hint: '64–65536，超限返回 RATE_LIMITED', type: 'num', min: 64, max: 65536 },
    { key: 'maxConnections', label: 'WebSocket 并发上限', hint: '8–1024', type: 'num', min: 8, max: 1024 },
    { key: 'maxDevicesPerAccount', label: '每账号设备上限', hint: '1–4096', type: 'num', min: 1, max: 4096 }] },
]

export function SettingsPage() {
  const [d, reload] = useData<any>('/api/v1/admin/settings')
  const toast = useToast()
  const copy = useCopy()
  const [s, setS] = useState<any>(null)
  const [tab, setTab] = useState('base')
  const [stunUrl, setStunUrl] = useState(''), [stunLabel, setStunLabel] = useState('')
  const [stunFilter, setStunFilter] = useState<'all' | 'on' | 'off'>('all')
  const [q, setQ] = useState('')
  const [originInput, setOriginInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [cfm, setCfm] = useState<ConfirmState>(null)
  useEffect(() => { if (d) setS(d.settings) }, [d])
  const stuns: any[] = s?.stunServers ?? []
  const origins: { origin: string; enabled: boolean }[] = s?.originRules ?? []
  const errors = useMemo(() => {
    const e: Record<string, string> = {}
    if (!s) return e
    for (const g of GROUPS) for (const f of g.fields) {
      if (f.type !== 'num') continue
      const raw = s[f.key]
      const v = Number(raw)
      if (raw === '' || raw === null || raw === undefined || !Number.isFinite(v)) e[f.key] = '请输入数字'
      else if (f.min !== undefined && v < f.min) e[f.key] = `不能小于 ${f.min}`
      else if (f.max !== undefined && v > f.max) e[f.key] = `不能大于 ${f.max}`
    }
    if (!e.heartbeatDisconnectMs && Number(s.heartbeatDisconnectMs) < 2 * Number(s.heartbeatMs)) e.heartbeatDisconnectMs = '需 ≥ 2×心跳间隔'
    return e
  }, [s])
  if (!s) return <div className="st-skel"><i /><i /><i /></div>
  const dirty = Boolean(d?.settings && JSON.stringify(s) !== JSON.stringify(d.settings))
  const errCount = Object.keys(errors).length
  const set = (k: string, v: any) => setS({ ...s, [k]: v })
  const save = async (body: any) => {
    setSaving(true)
    try {
      const r = await api<any>('/api/v1/admin/settings', { method: 'PUT', body })
      if (r.settings) setS(r.settings)
      toast('s', '设置已生效'); reload()
    } catch (e: any) { toast('e', e.message) } finally { setSaving(false) }
  }
  const maxStun = Math.max(1, Math.min(16, Number(s.maxEnabledStun) || 6))
  const onCount = stuns.filter(x => x.enabled).length
  const list = stuns.map((x, idx) => ({ ...x, idx })).filter(x =>
    (stunFilter === 'all' || (stunFilter === 'on' ? x.enabled : !x.enabled)) &&
    (!q || `${x.url} ${x.label} ${x.region}`.toLowerCase().includes(q.toLowerCase())))
  const setStuns = (v: any[]) => set('stunServers', v)
  const addStun = () => {
    const url = stunUrl.trim()
    if (!/^stuns?:[^\s]+$/i.test(url)) return toast('e', '请输入有效的 stun: 或 stuns: 地址')
    if (stuns.some(x => x.url.toLowerCase() === url.toLowerCase())) return toast('e', '该 STUN 地址已存在')
    if (stuns.length >= 64) return toast('e', '最多保留 64 条 STUN')
    const enabled = onCount < maxStun
    if (!enabled) toast('e', `已达启用上限(${maxStun}),已添加为禁用`)
    setStuns([{ url, label: stunLabel.trim() || '自定义', region: '自定义', enabled }, ...stuns]); setStunUrl(''); setStunLabel('')
  }
  const toggleStun = (i: number) => {
    const c = stuns[i]
    if (c && !c.enabled && onCount >= maxStun) return toast('e', `最多同时启用 ${maxStun} 条`)
    setStuns(stuns.map((x, j) => j === i ? { ...x, enabled: !x.enabled } : x))
  }
  const enableRecommended = () => { let n = 0; setStuns(stuns.map(x => ({ ...x, enabled: String(x.region || '').includes('推荐') && n++ < maxStun }))) }
  const addOrigin = () => {
    const o = originInput.trim().replace(/\/+$/, '')
    if (!/^https?:\/\/[^\s/]+$/i.test(o)) return toast('e', '请输入合法的 Origin(如 https://dsh.example.com)')
    if (origins.some(x => x.origin.toLowerCase() === o.toLowerCase())) return toast('e', '该 Origin 已存在')
    if (origins.length >= 32) return toast('e', '最多保留 32 条 Origin')
    set('originRules', [...origins, { origin: o, enabled: true }]); setOriginInput('')
  }
  const tabs = [...GROUPS.map(g => ({ id: g.id, title: g.title, icon: g.icon })), { id: 'stun', title: 'STUN 列表', icon: Cloud }, { id: 'origin', title: 'Origin', icon: Wifi }]
  const grp = GROUPS.find(g => g.id === tab)
  return (
    <div className="st">
      <div className="page-head"><div className="page-head-text"><h1>系统设置</h1><p className="sub">默认值来自 wrangler.jsonc 的 vars(DSH_*);修改后保存即时生效</p></div>
        <div className="page-head-actions"><button className="btn" onClick={() => setCfm({ title: '恢复默认设置', body: '确定将所有系统设置恢复为环境变量默认值吗？', okText: '确认恢复', onOk: () => save(d.defaults) })}><RotateCcw size={15} />恢复默认</button></div></div>
      <div className="st-tabs">{tabs.map(t => <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}><t.icon size={14} />{t.title}</button>)}</div>
      {grp && <div className="card"><div className="st-form">{grp.fields.map(f => (
        <div className={`field ${errors[f.key] ? 'bad' : ''}`} key={f.key}>
          <div className="st-lbl"><label>{f.label}</label>{f.type === 'bool' && <button className={`toggle ${s[f.key] ? 'on' : ''}`} onClick={() => set(f.key, !s[f.key])} />}</div>
          {f.type !== 'bool' && <input type={f.type === 'num' ? 'number' : 'text'} inputMode={f.type === 'num' ? 'numeric' : undefined} value={s[f.key] ?? ''} onChange={e => set(f.key, f.type === 'num' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />}
          <p className="hint">{errors[f.key] ? <span className="st-err">{errors[f.key]}</span> : f.hint}</p></div>))}</div></div>}
      {tab === 'stun' && <div className="card">
        <div className="st-row"><span className={`badge ${s.stunEnabled ? 'ok' : 'warn'}`}><i />{s.stunEnabled ? `已启用 ${onCount} / 上限 ${maxStun}(共 ${stuns.length})` : 'STUN 总开关已关闭'}</span></div>
        <p className="hint">STUN 仅用于 P2P 建连阶段探测 NAT 公网地址(不中转流量)。</p>
        <div className="st-add"><input placeholder="stun:stun.miwifi.com:3478" value={stunUrl} onChange={e => setStunUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && addStun()} />
          <input placeholder="备注(可选)" value={stunLabel} onChange={e => setStunLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && addStun()} />
          <button className="btn pri" onClick={addStun}><Plus size={15} />添加</button></div>
        <div className="st-row">
          <div className="st-seg">{(['all', 'on', 'off'] as const).map(k => <button key={k} className={stunFilter === k ? 'on' : ''} onClick={() => setStunFilter(k)}>{k === 'all' ? `全部 ${stuns.length}` : k === 'on' ? `启用 ${onCount}` : `禁用 ${stuns.length - onCount}`}</button>)}</div>
          <div className="st-search"><Search size={14} /><input placeholder="搜索" value={q} onChange={e => setQ(e.target.value)} /></div>
          <button className="btn sm" onClick={enableRecommended}>仅启用推荐</button>
          <button className="btn sm" onClick={() => setStuns(stuns.map(x => ({ ...x, enabled: false })))}>全部禁用</button>
          <button className="btn sm" onClick={() => setStuns(d?.defaultStun ?? d?.defaults?.stunServers ?? [])}>恢复默认列表</button></div>
        {list.length ? <div className="st-grid">{list.map(x => (
          <div key={x.url} className={`st-card ${x.enabled ? '' : 'off'}`}>
            <div className="st-top"><b>{x.label || '公共 STUN'}</b><span className={`badge ${x.builtin ? '' : 'ok'}`}>{x.region || (x.builtin ? '内置' : '自定义')}</span>
              <span className="st-sp" /><button className={`toggle ${x.enabled ? 'on' : ''}`} onClick={() => toggleStun(x.idx)} />
              <button className="icon-btn" title="复制" onClick={() => copy(x.url, 'STUN 地址')}><Copy size={14} /></button>
              <button className="icon-btn" title="删除" onClick={() => setStuns(stuns.filter((_, j) => j !== x.idx))}><Trash2 size={14} /></button></div>
            <code>{x.url}</code></div>))}</div> : <div className="empty">暂无匹配的 STUN 服务器</div>}
      </div>}
      {tab === 'origin' && <div className="card">
        <div className="st-row"><span className="badge"><i />已启用 {origins.filter(x => x.enabled).length} / {origins.length}</span></div>
        <p className="hint">与访问域名相同的无需填写;仅在需要额外允许跨域 Origin 时添加。</p>
        <div className="st-add"><input placeholder="https://dsh.example.com" value={originInput} onChange={e => setOriginInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addOrigin()} />
          <button className="btn pri" onClick={addOrigin}><Plus size={15} />添加</button></div>
        {origins.length ? <div className="st-grid">{origins.map((x, i) => (
          <div key={x.origin} className={`st-card ${x.enabled ? '' : 'off'}`}><div className="st-top"><span className={`badge ${x.enabled ? 'ok' : ''}`}><i />{x.enabled ? '已启用' : '已禁用'}</span><span className="st-sp" />
            <button className={`toggle ${x.enabled ? 'on' : ''}`} onClick={() => set('originRules', origins.map((o, j) => j === i ? { ...o, enabled: !o.enabled } : o))} />
            <button className="icon-btn" title="删除" onClick={() => set('originRules', origins.filter((_, j) => j !== i))}><Trash2 size={14} /></button></div><code>{x.origin}</code></div>))}</div>
          : <div className="empty">未配置额外 Origin(默认仅允许同源访问)</div>}
      </div>}
      <div className={`st-bar ${dirty ? 'show' : ''}`}>
        <span className={`badge ${errCount ? '' : 'warn'}`}><i />{errCount ? `${errCount} 项校验未通过` : '有未保存的更改'}</span><span className="st-sp" />
        <button className="btn sm" onClick={() => setS(d.settings)}>撤销</button>
        <button className="btn pri sm" disabled={!!errCount || saving} onClick={() => save(s)}><Save size={14} />{saving ? '保存中…' : '保存'}</button></div>
      <Confirm state={cfm} onClose={() => setCfm(null)} />
    </div>)
}