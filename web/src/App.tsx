import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Activity, KeyRound, LayoutDashboard, Link2, LogOut, Moon, Radio, ScrollText, Server, Settings, Sun, Ticket, User, Users, Wifi } from 'lucide-react'
import { api, CODE_MSG } from './lib/api'
import { ToastCtx } from './lib/toast'
import { ProviderIcon } from './components/ui'
import { Accounts } from './pages/accounts'
import { AllDevices, MyDevices } from './pages/devices'
import { Events } from './pages/events'
import { InvitesPage } from './pages/invites'
import { Links } from './pages/links'
import { NetworkPage } from './pages/network'
import { OAuth } from './pages/oauth'
import { Overview } from './pages/overview'
import { ProfilePage } from './pages/profile'
import { SettingsPage } from './pages/settings'
import { Turn } from './pages/turn'

type Toast = { id: number; kind: 's' | 'e'; text: string }
type Me = { account: string; isAdmin: boolean; rootAdmin?: boolean; adminPerms?: string[] }

const ADMIN_TABS = [
  ['overview', '概览', LayoutDashboard, Overview], ['devices', '全部设备', Server, AllDevices], ['accounts', '账号管理', Users, Accounts],
  ['links', '实时连接', Link2, Links], ['turn', 'TURN 中转', Radio, Turn], ['settings', '系统设置', Settings, SettingsPage],
  ['oauth', 'OAuth 登录', KeyRound, OAuth], ['invites', '邀请码', Ticket, InvitesPage], ['events', '审计日志', ScrollText, Events],
  ['my-devices', '我的设备', Activity, MyDevices], ['profile', '个人中心', User, ProfilePage], ['network', '网络诊断', Wifi, NetworkPage],
] as const
const PUBLIC_TABS = new Set(['my-devices', 'profile', 'network'])

const USER_TABS = [
  ['devices', '我的设备', Activity, MyDevices],
  ['profile', '个人中心', User, ProfilePage],
  ['network', '网络诊断', Wifi, NetworkPage],
] as const

const GhIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ verticalAlign: '-2px' }}>
    <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.19-1.49 3.16-1.18 3.16-1.18.62 1.59.23 2.76.11 3.05.74.8 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14 0 1.54-.01 2.79-.01 3.17 0 .31.21.66.79.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"/>
  </svg>
)
declare const __APP_VERSION__: string

const CopyRight = () => (
  <>@copyright 2026 <a href="https://github.com/XCQ0607" target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>XCQ0607</a> · v{__APP_VERSION__} · <a href="https://github.com/XCQ0607/dsh-remote-worker" target="_blank" rel="noreferrer" title="GitHub 仓库" style={{ color: 'inherit' }}><GhIcon /></a></>
)

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const [oauth, setOauth] = useState<{ id: string; displayName: string; startUrl: string }[]>([])
  const [invToken, setInvToken] = useState(() => new URLSearchParams(location.search).get('oauth_invite') ?? '')
  const [invCode, setInvCode] = useState('')
  const [qrDone, setQrDone] = useState(false)
  useEffect(() => {
    api('/api/v1/auth/oauth/providers').then(r => setOauth(r.items ?? [])).catch(() => { })
    const sp = new URLSearchParams(location.search)
    const e = sp.get('oauth_error')
    if (e) { setErr(CODE_MSG[e] || `第三方登录失败: ${e}`); history.replaceState(null, '', '/') }
    if (sp.get('oauth_invite')) history.replaceState(null, '', '/')
  }, [])
  const go = async () => {
    setBusy(true); setErr('')
    try { await api('/api/v1/auth/login', { body: { email, password } }); onDone() } catch (err: any) { setErr(err?.message || '账号或密码错误') } finally { setBusy(false) }
  }
  const submitInvite = async () => {
    setBusy(true); setErr('')
    try {
      const r = await api('/api/v1/auth/oauth/invite', { method: 'POST', body: { token: invToken, code: invCode.trim() } })
      if (r.qr) setQrDone(true)
      else onDone()
    } catch (e: any) { setErr(e.message || '邀请码无效或已过期') } finally { setBusy(false) }
  }
  if (qrDone) return (
    <div className="login"><div className="card" style={{ textAlign: 'center' }}>
      <h2>授权成功</h2><p className="sub">已完成注册并授权，请关闭此页面并返回客户端继续。</p>
    </div></div>
  )
  if (invToken) return (
    <div className="login"><div className="card">
      <img src="/favicon.svg" alt="DSH Remote" style={{ display: 'block', margin: '0 auto', width: 48, height: 48 }} />
      <h1>需要邀请码</h1><p className="sub" style={{ textAlign: 'center' }}>首次使用第三方账号注册，请输入邀请码</p>
      <div className="field"><label>邀请码</label><input value={invCode} onChange={e => setInvCode(e.target.value)} placeholder="请输入邀请码" onKeyDown={e => e.key === 'Enter' && submitInvite()} /></div>
      {err && <p className="hint" style={{ color: 'var(--bad)' }}>{err}</p>}
      <button className="btn pri" style={{ width: '100%', justifyContent: 'center' }} disabled={busy || !invCode.trim()} onClick={submitInvite}>验证并完成注册</button>
      <button className="btn" style={{ width: '100%', justifyContent: 'center', marginTop: 10 }} onClick={() => setInvToken('')}>返回登录</button>
    </div></div>
  )
  return (
    <div className="login"><div className="card">
      <img src="/favicon.svg" alt="DSH Remote" style={{ display: 'block', margin: '0 auto', width: 48, height: 48 }} />
      <h1>DSH Remote</h1><p className="sub" style={{ textAlign: 'center' }}>Cloudflare Worker 自建中转服务</p>
      <div className="field"><label>账号邮箱</label><input value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" /></div>
      <div className="field"><label>密码</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" onKeyDown={e => e.key === 'Enter' && go()} /></div>
      {err && <p className="hint" style={{ color: 'var(--bad)' }}>{err}</p>}
      <button className="btn pri" style={{ width: '100%', justifyContent: 'center' }} disabled={busy || !email || !password} onClick={go}>登录</button>
      {oauth.map(p => <a key={p.id} className="btn" style={{ width: '100%', justifyContent: 'center', marginTop: 10, boxSizing: 'border-box', textDecoration: 'none' }} href={p.startUrl}><ProviderIcon id={p.id} size={16} />使用 {p.displayName} 登录</a>)}
      <p className="hint" style={{ textAlign: 'center', marginTop: 16 }}><CopyRight /></p>
    </div></div>
  )
}

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined)
  const [tab, setTab] = useState(() => location.hash.slice(1) || 'overview')
  const [dark, setDark] = useState(() => localStorage.getItem('dsh_theme') ? localStorage.getItem('dsh_theme') === 'dark' : !matchMedia('(prefers-color-scheme: light)').matches)
  const [toasts, setToasts] = useState<Toast[]>([])
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('dsh_theme', dark ? 'dark' : 'light') }, [dark])
  const toast = useCallback((kind: 's' | 'e', text: string) => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, kind, text }]); setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
  }, [])
  const load = useCallback(() => { api<Me>('/api/v1/auth/me').then(setMe).catch(() => setMe(null)) }, [])
  const navRef = useRef<HTMLElement | null>(null)
  useEffect(load, [load])
  useEffect(() => {
    if (!me) return
    const allowed = me.isAdmin
      ? ADMIN_TABS.filter(([id]) => PUBLIC_TABS.has(id) || me.rootAdmin || !me.adminPerms || me.adminPerms.includes(id))
      : USER_TABS
    if (allowed.length && !allowed.some(t => t[0] === tab)) setTab(allowed[0][0])
    else location.hash = tab
  }, [me, tab])
  // 手机端导航是横向滚动条，切换后把当前项滚进可视区
  useEffect(() => {
    const box = navRef.current
    const active = box?.querySelector<HTMLElement>('.nav.on')
    if (!box || !active || box.scrollWidth <= box.clientWidth) return
    box.scrollTo({ left: Math.max(0, active.offsetLeft - (box.clientWidth - active.offsetWidth) / 2), behavior: 'smooth' })
  }, [tab])

  let body: ReactNode
  if (me === undefined) body = null
  else if (me === null) body = <Login onDone={load} />
  else {
    const tabs = me.isAdmin
      ? ADMIN_TABS.filter(([id]) => PUBLIC_TABS.has(id) || me.rootAdmin || !me.adminPerms || me.adminPerms.includes(id))
      : USER_TABS
    const activeTab = tabs.some(t => t[0] === tab) ? tab : tabs[0][0]
    const Page = (tabs.find(t => t[0] === activeTab)?.[3] ?? tabs[0][3]) as () => ReactNode
    body = (
      <div className="app">
        <aside className="side">
          <div className="side-head">
            <div className="brand"><img src="/favicon.svg" alt="DSH Remote" style={{ width: 28, height: 28 }} />DSH Remote</div>
            <div className="side-actions">
              <button className="nav icon-only" title={dark ? '浅色模式' : '深色模式'} onClick={() => setDark(d => !d)}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
              <button className="nav icon-only" title="退出登录" onClick={async () => { await api('/api/v1/auth/logout', { method: 'POST', body: {} }); setMe(null) }}><LogOut size={18} /></button>
            </div>
          </div>
          <nav className="side-nav" ref={navRef}>
            {tabs.map(([id, label, Icon]) => (
              <button key={id} className={`nav ${activeTab === id ? 'on' : ''}`} onClick={() => setTab(id)}><Icon size={18} /><span>{label}</span></button>
            ))}
          </nav>
          <div className="grow side-foot-spacer" />
          <div className="side-foot">
            <div className="mono" style={{ padding: '0 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><KeyRound size={12} /> {me.account}</div>
            <button className="nav" onClick={() => setDark(d => !d)}>{dark ? <Sun size={18} /> : <Moon size={18} />}<span>{dark ? '浅色模式' : '深色模式'}</span></button>
            <button className="nav" onClick={async () => { await api('/api/v1/auth/logout', { method: 'POST', body: {} }); setMe(null) }}><LogOut size={18} /><span>退出登录</span></button>
            <div className="hint" style={{ padding: '6px 12px 0' }}><CopyRight /></div>
          </div>
        </aside>
        <main className="main"><Page /><footer className="mob-foot hint"><CopyRight /></footer></main>
      </div>
    )
  }
  return <ToastCtx.Provider value={toast}>{body}<div className="toast">{toasts.map(t => <div key={t.id} className={t.kind}>{t.text}</div>)}</div></ToastCtx.Provider>
}
