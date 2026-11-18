import { useState } from 'react'
import { api } from '../lib/api'
import { useToast } from '../lib/toast'
import { useData } from '../lib/useData'
import { WebhookPanel } from '../components/webhooks'

const copy = async (t: string, toast: any) => {
  try { await navigator.clipboard.writeText(t); toast('s', '已复制') } catch { toast('e', '复制失败') }
}
const left = (t: number) => { const s = Math.max(0, Math.floor((t - Date.now()) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
const dev = (ua: string) => {
  if (!ua) return { n: 'Web / Client', i: '🖥️' }
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : ua.slice(0, 24)
  const o = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : ''
  return { n: `${b}${o ? ' · ' + o : ''}`, i: /Android|iPhone|iPad/.test(ua) ? '📱' : '🖥️' }
}
const strength = (p: string) => [p.length >= 12, /[a-z]/.test(p) && /[A-Z]/.test(p), /\d/.test(p), /[^A-Za-z0-9]/.test(p), p.length >= 16].filter(Boolean).length

const TABS: [string, string][] = [['account', '账号安全'], ['sessions', '登录会话'], ['codes', '主机匹配码'], ['webhook', 'Webhook 告警']]

export function ProfilePage() {
  const [tab, setTab] = useState(() => { const s = localStorage.getItem('profile.tab') || ''; return TABS.some(t => t[0] === s) ? s : 'account' })
  const [p, reload] = useData<any>('/api/v1/account/profile', 15000)
  const [codes, reloadCodes] = useData<any>('/api/v1/account/host-registration-codes', 5000)
  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const go = (t: string) => { setTab(t); localStorage.setItem('profile.tab', t) }
  const run = async (fn: () => Promise<any>, ok: string) => { if (busy) return; setBusy(true); try { await fn(); toast('s', ok) } catch (e: any) { toast('e', e.message) } finally { setBusy(false) } }
  const sessions: any[] = p?.sessions ?? []
  const items: any[] = codes?.items ?? []
  const st = strength(newPw)

  return <>
    <div className="head"><h2>个人中心</h2><p className="hint">{p?.email ?? '-'} · 设备配额 {p?.maxDevices ?? '-'} 台 · {sessions.length} 个活跃会话</p></div>
    <div className="pf-tabs" role="tablist">{TABS.map(([k, v]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => go(k)}>{v}{k === 'codes' && items.length ? <em>{items.length}</em> : null}{k === 'sessions' && sessions.length ? <em>{sessions.length}</em> : null}</button>)}</div>

    {tab === 'account' && <div className="card">
      <h3>{p?.hasPassword ? '修改密码' : '设置初始密码'}</h3>
      <form onSubmit={e => { e.preventDefault(); void run(async () => { await api('/api/v1/account/password', { method: 'POST', body: { currentPassword: curPw, newPassword: newPw } }); setCurPw(''); setNewPw(''); reload() }, '密码已更新') }}>
        <div className="form-grid">
          {p?.hasPassword && <label className="field"><span>当前密码</span><input type="password" autoComplete="current-password" value={curPw} onChange={e => setCurPw(e.target.value)} required /></label>}
          <label className="field"><span>新密码（≥12 位）</span><input type="password" autoComplete="new-password" minLength={12} value={newPw} onChange={e => setNewPw(e.target.value)} required />
            <div className="pf-meter">{[0, 1, 2, 3, 4].map(i => <i key={i} className={i < st ? `l${st}` : ''} />)}<span className="hint">{['', '太弱', '较弱', '一般', '良好', '很强'][st]}</span></div></label>
        </div>
        <div className="form-actions"><button className="btn pri" disabled={busy || newPw.length < 12}>{p?.hasPassword ? '修改密码' : '设置密码'}</button></div>
      </form>
    </div>}

    {tab === 'sessions' && <div className="card">
      <div className="wh-head"><h3 style={{ margin: 0 }}>登录会话</h3>
        {sessions.filter(s => !s.current).length > 0 && <button className="btn sm danger" onClick={() => run(async () => { const r = await api('/api/v1/account/sessions-others', { method: 'DELETE' }); reload(); return r }, '已下线其他设备')}>下线其他会话</button>}</div>
      <div className="wh-list">{sessions.map(s => { const d = dev(s.ua); return <div className="wh-item" key={s.id}>
        <span className="wh-ico" style={{ background: 'var(--panel)', fontSize: 18 }}>{d.i}</span>
        <div className="wh-main"><div className="wh-title">{d.n}{s.current && <span className="badge ok"><i />当前会话</span>}</div><div className="hint mono">{s.id} · 过期 {new Date(s.expires).toLocaleString()}</div></div>
        {!s.current && <button className="btn sm danger" onClick={() => run(async () => { await api(`/api/v1/account/sessions/${encodeURIComponent(s.id)}`, { method: 'DELETE' }); reload() }, '已下线')}>踢下线</button>}
      </div> })}{!sessions.length && <div className="empty">暂无会话</div>}</div>
    </div>}

    {tab === 'codes' && <div className="card">
      <div className="wh-head"><div><h3 style={{ margin: 0 }}>主机匹配码</h3><div className="hint">在主机端输入匹配码即可绑定到当前账号 · 10 分钟有效 · 最多同时 5 个</div></div>
        <button className="btn pri sm" disabled={busy || items.length >= 5} onClick={() => run(async () => { await api('/api/v1/account/host-registration-codes', { method: 'POST', body: {} }); reloadCodes() }, '已生成')}>＋ 生成匹配码</button></div>
      <div className="pf-codes">{items.map(c => <div className="pf-code" key={c.registrationId}>
        <button className="pf-code-v mono" title="点击复制" onClick={() => copy(c.code, toast)}>{c.code}</button>
        <span className="hint">剩余 {left(c.expiresAt)}</span>
        <button className="btn sm danger" onClick={() => run(async () => { await api(`/api/v1/account/host-registration-codes/${encodeURIComponent(c.registrationId)}`, { method: 'DELETE' }); reloadCodes() }, '已作废')}>作废</button>
      </div>)}{!items.length && <div className="empty">暂无有效匹配码</div>}</div>
    </div>}

    {tab === 'webhook' && <WebhookPanel />}
  </>
}
