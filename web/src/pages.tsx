import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Ban, CheckCircle2, Cloud, Copy, Cpu, KeyRound, Pencil, Plug, Plus, RefreshCw, Save, Search, Trash2, Unplug, Users as UsersIcon, XCircle } from 'lucide-react'
import { api, fmtAgo, fmtDur } from './api'
import { useToast } from './toast'
import { Modal, ProviderIcon, Select } from './ui'

function useData<T>(path: string, every = 0) {
  const [data, setData] = useState<T | null>(null)
  const toast = useToast()
  const reload = useCallback(() => { api<T>(path).then(setData).catch(e => toast('e', String(e.message))) }, [path, toast])
  useEffect(() => { reload(); if (!every) return; const t = setInterval(reload, every); return () => clearInterval(t) }, [reload, every])
  return [data, reload] as const
}
const Head = ({ title, sub, children }: { title: string; sub: string; children?: ReactNode }) => (
  <div className="page-head"><div className="page-head-text"><h1>{title}</h1><p className="sub">{sub}</p></div>{children && <div className="page-head-actions">{children}</div>}</div>
)
const Badge = ({ ok, children }: { ok: boolean; children: ReactNode }) => <span className={`badge ${ok ? 'ok' : ''}`}><i />{children}</span>
const Stat = ({ icon, label, value, unit }: { icon: ReactNode; label: string; value: ReactNode; unit?: string }) => (
  <div className="card"><h3>{icon}{label}</h3><div className="stat">{value}{unit && <small>{unit}</small>}</div></div>
)

export function Overview() {
  const [d, reload] = useData<any>('/api/v1/admin/overview', 5000)
  const toast = useToast()
  if (!d) return null
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast('s', '已复制接入地址') } catch { toast('e', '复制失败') } }
  const testTurn = async () => {
    try { const r = await api<any>('/api/v1/admin/turn/test', { body: {} }); toast(r.turn ? 's' : 'e', r.turn ? `TURN 正常(${r.servers.length} 组地址)` : `TURN 未启用: ${r.error ?? '未配置'}`) } catch (e: any) { toast('e', e.message) }
  }
  return (<>
    <Head title={d.siteName} sub={`已运行 ${fmtDur(d.uptimeMs)} · ${d.origin}`}>
      <button className="btn" onClick={() => copy(d.origin)}><Copy size={15} />复制地址</button>
      <button className="btn" onClick={reload}><RefreshCw size={15} />刷新</button>
    </Head>
    <div className="grid">
      <Stat icon={<UsersIcon size={15} />} label="账号" value={d.accounts} />
      <Stat icon={<Cpu size={15} />} label="设备" value={d.devices.total} unit={`${d.devices.hosts} Host / ${d.devices.clients} Client`} />
      <Stat icon={<Plug size={15} />} label="在线设备" value={d.devices.online} />
      <Stat icon={<Cloud size={15} />} label="活动连接" value={d.links} unit={`${d.sockets} WS`} />
    </div>
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,280px),1fr))' }}>
      <div className="card"><h3>TURN 中转</h3>
        <div className="row"><Badge ok={d.turn.enabled}>{d.turn.enabled ? '已启用' : d.turn.configured ? '已配置但被关闭' : '未配置(仅 Relay)'}</Badge>
          <button className="btn sm right" onClick={testTurn}><CheckCircle2 size={14} />测试签发</button></div>
        <p className="hint">{d.turn.keyId ? `Key: ${d.turn.keyId}` : '前往「TURN 中转」页一键创建 Cloudflare TURN Key。'}</p></div>
      <div className="card"><h3>运行参数与免费额度</h3>
        <p className="hint" style={{ fontSize: 13 }}>P2P {d.config?.p2pEnabled === false ? '关' : '开'} · STUN {d.config?.stunEnabled === false ? '关' : '开'} · 心跳 {Math.round((d.config?.heartbeatMs ?? 25000) / 1000)}s · WS 上限 {d.config?.maxConnections ?? 256} · TURN TTL {d.config?.turnTtlSeconds ?? 300}s</p>
        <p className="hint" style={{ fontSize: 13 }}>Workers 免费版每日 10 万请求、DO 13,000 GB-s，启用 Hibernation 空闲不计时。</p>
        <div className="bar"><div style={{ width: `${Math.min(100, d.sockets * 4)}%` }} /></div></div>
    </div>
  </>)
}

export function MyDevices() {
  const [d, reload] = useData<any>('/api/v1/account/devices', 8000)
  const toast = useToast()
  const [pw, setPw] = useState({ oldPassword: '', newPassword: '' })
  const [me, reloadMe] = useData<any>('/api/v1/auth/me')
  const rename = async (id: string, cur: string) => {
    const name = prompt('输入新的设备名称', cur)?.trim()
    if (!name || name === cur) return
    try { await api(`/api/v1/devices/${encodeURIComponent(id)}/name`, { body: { name } }); toast('s', '已重命名'); reload() } catch (e: any) { toast('e', e.message) }
  }
  const revoke = async (id: string) => {
    if (!confirm('吊销后该设备需重新配对登录，确定?')) return
    try { await api(`/api/v1/account/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }); toast('s', '已吊销'); reload() } catch (e: any) { toast('e', e.message) }
  }
  const changePw = async () => {
    try { await api('/api/v1/account/password', { body: pw }); toast('s', '密码已修改'); setPw({ oldPassword: '', newPassword: '' }); reloadMe() } catch (e: any) { toast('e', e.code === 'AUTH_INVALID' ? '原密码错误' : e.message) }
  }
  return (<>
    <Head title="我的设备" sub={d ? `接入地址: ${d.serverUrl}` : '已注册到此账号的 Host 与 Client'}>
      {d?.serverUrl && <button className="btn" onClick={() => { navigator.clipboard.writeText(d.serverUrl); toast('s', '已复制接入地址') }}><Copy size={15} />复制接入地址</button>}
      <button className="btn" onClick={reload}><RefreshCw size={15} />刷新</button>
    </Head>
    <div className="card tablecard" style={{ marginBottom: 16 }}><table><thead><tr><th>名称</th><th>角色</th><th>平台</th><th>状态</th><th>最近在线</th><th /></tr></thead><tbody>
      {d?.items?.map((x: any) => <tr key={x.deviceId}><td data-label="名称">{x.name || x.deviceId}<div className="mono">{x.deviceId}</div></td><td data-label="角色">{x.role}</td><td data-label="平台">{x.platform ?? '-'}</td><td data-label="状态"><Badge ok={x.online}>{x.online ? '在线' : '离线'}</Badge></td><td data-label="最近在线" className="mono">{fmtAgo(x.lastSeenAt)}</td>
        <td><div className="row"><button className="btn sm" onClick={() => rename(x.deviceId, x.name || '')}><Pencil size={13} />改名</button>
          <button className="btn sm danger" onClick={() => revoke(x.deviceId)}><Ban size={13} />吊销</button></div></td></tr>)}
    </tbody></table>{d && !d.items.length && <div className="empty">暂无设备</div>}</div>
    <div className="card"><h3><KeyRound size={15} />修改登录密码</h3>
      <div className="form2">{!me?.oauthInit && <div className="field"><label>原密码</label><input type="password" value={pw.oldPassword} onChange={e => setPw({ ...pw, oldPassword: e.target.value })} /></div>}
        <div className="field"><label>新密码(≥12 位)</label><input type="password" value={pw.newPassword} onChange={e => setPw({ ...pw, newPassword: e.target.value })} /></div></div>
      <button className="btn pri" disabled={(!me?.oauthInit && !pw.oldPassword) || pw.newPassword.length < 12} onClick={changePw}><Save size={15} />更新密码</button></div>
  </>)
}

export function AllDevices() {
  const [d, reload] = useData<any>('/api/v1/admin/devices', 6000)
  const [q, setQ] = useState(''), [only, setOnly] = useState<'all' | 'on' | 'off'>('all')
  const toast = useToast()
  const act = async (id: string, a: 'disconnect' | 'revoke') => {
    if (a === 'revoke' && !confirm('吊销后该设备需重新注册,确定?')) return
    try { await api(`/api/v1/admin/devices/${encodeURIComponent(id)}/${a}`, { body: {} }); toast('s', '已执行'); reload() } catch (e: any) { toast('e', e.message) }
  }
  const items = (d?.items ?? []).filter((x: any) =>
    (only === 'all' || (only === 'on' ? x.online : !x.online))
    && (!q || `${x.name ?? ''} ${x.deviceId} ${x.account}`.toLowerCase().includes(q.toLowerCase())))
  return (<>
    <Head title="全部设备" sub="跨账号查看、踢下线、吊销"><button className="btn" onClick={reload}><RefreshCw size={15} />刷新</button></Head>
    <div className="row" style={{ marginBottom: 14 }}>
      <div className="search-box"><Search size={14} /><input placeholder="搜索设备名 / ID / 账号" value={q} onChange={e => setQ(e.target.value)} /></div>
      <div className="seg">{(['all', 'on', 'off'] as const).map(k => <button key={k} className={`btn ${only === k ? 'pri' : ''}`} onClick={() => setOnly(k)}>{k === 'all' ? '全部' : k === 'on' ? '仅在线' : '仅离线'}</button>)}</div>
    </div>
    <div className="card tablecard"><table><thead><tr><th>设备</th><th>账号</th><th>角色</th><th>版本</th><th>状态</th><th>最近在线</th><th /></tr></thead><tbody>
      {items.map((x: any) => <tr key={x.deviceId}>
        <td data-label="设备">{x.name || '-'}<div className="mono">{x.deviceId}</div></td><td data-label="账号">{x.account}</td><td data-label="角色">{x.role}</td><td data-label="版本" className="mono">{x.clientVersion ?? '-'}</td>
        <td data-label="状态"><Badge ok={x.online}>{x.online ? '在线' : '离线'}</Badge></td><td data-label="最近在线" className="mono">{fmtAgo(x.lastSeenAt)}</td>
        <td><div className="row">{x.online && <button className="btn sm" onClick={() => act(x.deviceId, 'disconnect')}><Unplug size={13} />踢下线</button>}
          <button className="btn sm danger" onClick={() => act(x.deviceId, 'revoke')}><Ban size={13} />吊销</button></div></td></tr>)}
    </tbody></table>{d && !items.length && <div className="empty">没有匹配的设备</div>}</div>
  </>)
}

export function Accounts() {
  const [d, reload] = useData<any>('/api/v1/admin/accounts', 8000)
  const toast = useToast()
  const [email, setEmail] = useState(''), [password, setPassword] = useState('')
  const [pwModal, setPwModal] = useState<{ email: string; pw: string } | null>(null)
  const save = async () => {
    try { await api('/api/v1/admin/accounts', { body: { email, password } }); toast('s', '账号与密码已保存'); setEmail(''); setPassword(''); reload() } catch (e: any) { toast('e', e.code === 'INVALID_MESSAGE' ? '密码至少 12 位' : e.message) }
  }
  const submitResetPw = async () => {
    if (!pwModal) return
    if (pwModal.pw.length < 12) { toast('e', '密码至少 12 位'); return }
    try { await api('/api/v1/admin/accounts', { body: { email: pwModal.email, password: pwModal.pw } }); toast('s', `${pwModal.email} 密码已重置`); setPwModal(null); reload() } catch (x: any) { toast('e', x.message) }
  }
  const toggleAdmin = async (e: string, next: boolean) => {
    try { await api(`/api/v1/admin/accounts/${encodeURIComponent(e)}/admin`, { body: { admin: next } }); toast('s', next ? `已将 ${e} 设为管理员` : `已取消 ${e} 的管理员权限`); reload() } catch (x: any) { toast('e', x.message) }
  }
  const del = async (e: string) => { if (!confirm(`删除账号 ${e} 及其全部设备?`)) return; try { await api(`/api/v1/admin/accounts/${encodeURIComponent(e)}`, { method: 'DELETE' }); toast('s', '已删除'); reload() } catch (x: any) { toast('e', x.message) } }
  return (<>
    <Head title="账号管理" sub="多账号隔离：支持新增账号、单行重置密码（含当前管理员自身）及分配管理员权限。" />
    <div className="card" style={{ marginBottom: 16 }}><h3><Plus size={15} />新增账号 / 重置密码</h3>
      <div className="form2"><div className="field"><label>邮箱</label><input value={email} onChange={e => setEmail(e.target.value)} /></div>
        <div className="field"><label>密码(≥12 位)</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} /></div></div>
      <button className="btn pri" disabled={!email || password.length < 12} onClick={save}><Save size={15} />保存</button></div>
    <div className="card tablecard"><table><thead><tr><th>账号</th><th>角色</th><th>设备</th><th>在线</th><th /></tr></thead><tbody>
      {d?.items?.map((a: any) => <tr key={a.email}><td data-label="账号">{a.email}</td>
        <td data-label="角色">{a.rootAdmin ? <span className="badge warn"><i />根管理员</span> : a.admin ? <span className="badge ok"><i />管理员</span> : <span className="badge"><i />普通用户</span>}</td>
        <td data-label="设备">{a.devices}</td><td data-label="在线">{a.online}</td>
        <td><div className="row">
          <button className="btn sm" onClick={() => setPwModal({ email: a.email, pw: '' })}><KeyRound size={13} />重置密码</button>
          {!a.rootAdmin && <button className="btn sm" onClick={() => toggleAdmin(a.email, !a.admin)}>{a.admin ? '取消管理' : '设为管理'}</button>}
          {!a.rootAdmin && <button className="btn sm danger" onClick={() => del(a.email)}><Trash2 size={13} />删除</button>}
        </div></td></tr>)}
    </tbody></table></div>
    {pwModal && (
      <Modal title={`重置密码 · ${pwModal.email}`} onClose={() => setPwModal(null)}>
        <div className="field"><label>新密码（至少 12 位）</label><input type="password" autoFocus value={pwModal.pw} onChange={e => setPwModal({ ...pwModal, pw: e.target.value })} onKeyDown={e => e.key === 'Enter' && submitResetPw()} /></div>
        <div className="row right"><button className="btn" onClick={() => setPwModal(null)}>取消</button><button className="btn pri" disabled={pwModal.pw.length < 12} onClick={submitResetPw}>确认重置</button></div>
      </Modal>
    )}
  </>)
}

const OAUTH_PRESETS = [
  { value: 'github', label: 'GitHub', icon: <ProviderIcon id="github" size={14} /> },
  { value: 'google', label: 'Google', icon: <ProviderIcon id="google" size={14} /> },
  { value: 'gitlab', label: 'GitLab', icon: <ProviderIcon id="gitlab" size={14} /> },
  { value: 'discord', label: 'Discord', icon: <ProviderIcon id="discord" size={14} /> },
  { value: 'microsoft', label: 'Microsoft', icon: <ProviderIcon id="microsoft" size={14} /> },
  { value: 'gitee', label: 'Gitee', icon: <ProviderIcon id="gitee" size={14} /> },
  { value: 'linuxdo', label: 'Linux.do', icon: <ProviderIcon id="linuxdo" size={14} /> },
  { value: 'custom', label: '自定义 OAuth2', icon: <ProviderIcon id="custom" size={14} /> },
]

export function OAuth() {
  const [d, reload] = useData<any>('/api/v1/admin/oauth')
  const toast = useToast()
  const empty = { preset: 'github', id: 'github', displayName: 'GitHub', clientId: '', clientSecret: '', authUrl: '', tokenUrl: '', userInfoUrl: '', scopes: '', editing: false }
  const [f, setF] = useState(empty)
  const onPreset = (v: string) => setF({
    ...f, preset: v, editing: false,
    id: v === 'custom' ? '' : v,
    displayName: OAUTH_PRESETS.find(x => x.value === v && v !== 'custom')?.label ?? '',
  })
  const set = async (id: string, body: object) => { try { await api(`/api/v1/admin/oauth/${id}`, { body }); reload() } catch (e: any) { toast('e', e.message) } }
  const add = async () => {
    try {
      await api('/api/v1/admin/oauth', {
        body: {
          id: f.id, displayName: f.displayName || f.id, clientId: f.clientId,
          ...(f.clientSecret ? { clientSecret: f.clientSecret } : {}),
          ...(f.preset === 'custom' ? { authUrl: f.authUrl, tokenUrl: f.tokenUrl, userInfoUrl: f.userInfoUrl, ...(f.scopes ? { scopes: f.scopes } : {}) } : {}),
        },
      })
      toast('s', `已保存 ${f.displayName || f.id}`); setF(empty); reload()
    } catch (e: any) { toast('e', e.message) }
  }
  const editRow = (p: any) => {
    const isPreset = OAUTH_PRESETS.some(x => x.value === p.id && x.value !== 'custom')
    setF({ preset: isPreset ? p.id : 'custom', id: p.id, displayName: p.displayName, clientId: p.clientId || '', clientSecret: '', authUrl: '', tokenUrl: '', userInfoUrl: '', scopes: '', editing: true })
    scrollTo({ top: 0, behavior: 'smooth' })
  }
  const del = async (id: string) => {
    if (!confirm(`删除后台配置的 ${id}？`)) return
    try { await api(`/api/v1/admin/oauth/${id}`, { method: 'DELETE' }); toast('s', '已删除'); reload() } catch (e: any) { toast('e', e.message) }
  }
  return (<>
    <Head title="OAuth 登录" sub="支持在后台直接新增/编辑/管理第三方登录（持久化在 DO 存储，重新部署不丢），也可通过 provider.json 预设。回调地址需填到对应平台应用中。">
      <button className="btn" onClick={reload}><RefreshCw size={15} />刷新</button>
    </Head>
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="row" style={{ marginBottom: 12 }}><h3 style={{ margin: 0 }}><Plus size={15} />{f.editing ? `编辑 ${f.displayName || f.id}` : '新增 / 覆盖 OAuth 提供方'}</h3>
        {f.editing && <button className="btn sm right" onClick={() => setF(empty)}>取消编辑</button>}</div>
      <div className="form2">
        <div className="field"><label>平台预设</label><Select value={f.preset} options={OAUTH_PRESETS} disabled={f.editing} onChange={onPreset} /></div>
        <div className="field"><label>标识 ID（小写字母/数字）</label><input value={f.id} disabled={f.preset !== 'custom' || f.editing} onChange={e => setF({ ...f, id: e.target.value })} placeholder="如 linuxdo" /></div>
        <div className="field"><label>显示名称</label><input value={f.displayName} onChange={e => setF({ ...f, displayName: e.target.value })} placeholder="如 GitHub" /></div>
        <div className="field"><label>Client ID</label><input value={f.clientId} onChange={e => setF({ ...f, clientId: e.target.value })} /></div>
        <div className="field"><label>{f.editing ? 'Client Secret（留空则保留原密钥）' : 'Client Secret'}</label><input type="password" value={f.clientSecret} onChange={e => setF({ ...f, clientSecret: e.target.value })} /></div>
        {f.preset === 'custom' && <>
          <div className="field"><label>Auth URL</label><input value={f.authUrl} onChange={e => setF({ ...f, authUrl: e.target.value })} placeholder="https://..." /></div>
          <div className="field"><label>Token URL</label><input value={f.tokenUrl} onChange={e => setF({ ...f, tokenUrl: e.target.value })} placeholder="https://..." /></div>
          <div className="field"><label>UserInfo URL</label><input value={f.userInfoUrl} onChange={e => setF({ ...f, userInfoUrl: e.target.value })} placeholder="https://..." /></div>
          <div className="field"><label>Scopes（可选）</label><input value={f.scopes} onChange={e => setF({ ...f, scopes: e.target.value })} placeholder="openid email" /></div>
        </>}
      </div>
      <button className="btn pri" disabled={!f.id || !f.clientId || (!f.editing && !f.clientSecret) || (f.preset === 'custom' && (!f.authUrl || !f.tokenUrl || !f.userInfoUrl))} onClick={add}><Save size={15} />保存</button>
    </div>
    <div className="card tablecard"><table><thead><tr><th>登录方式</th><th>启用登录</th><th>允许注册新用户</th><th>需要邀请码</th><th>回调地址</th><th /></tr></thead><tbody>
      {d?.items?.map((p: any) => <tr key={p.id}>
        <td data-label="登录方式"><span className="row" style={{ gap: 8 }}><ProviderIcon id={p.id} size={15} />{p.displayName} <span className="mono">({p.id})</span></span></td>
        <td data-label="启用登录"><button className={`toggle ${p.enabled ? 'on' : ''}`} onClick={() => set(p.id, { enabled: !p.enabled })} /></td>
        <td data-label="允许注册新用户"><button className={`toggle ${p.allowRegister ? 'on' : ''}`} onClick={() => set(p.id, { allowRegister: !p.allowRegister })} /></td>
        <td data-label="需要邀请码">{p.allowRegister ? <button className={`toggle ${(p.requireInviteCode ?? true) ? 'on' : ''}`} onClick={() => set(p.id, { requireInviteCode: !(p.requireInviteCode ?? true) })} /> : <span className="hint">-</span>}</td>
        <td data-label="回调地址" className="mono"><span className="row" style={{ gap: 6 }}>{p.callbackUrl}<button className="icon-btn" title="复制回调地址" onClick={() => { navigator.clipboard.writeText(p.callbackUrl); toast('s', '已复制回调地址') }}><Copy size={13} /></button></span></td>
        <td><div className="row"><button className="btn sm" onClick={() => editRow(p)}><Pencil size={13} />编辑</button>
          {p.source === 'dashboard' && <button className="btn sm danger" onClick={() => del(p.id)}><Trash2 size={13} />删除</button>}</div></td></tr>)}
    </tbody></table>{d && !d.items.length && <div className="empty">尚未配置任何 OAuth 提供方，可在上方直接添加</div>}</div>
    <OAuthEmailRules />
  </>)
}

function OAuthEmailRules() {
  const [cfg, reload] = useData<any>('/api/v1/admin/settings')
  const [allow, setAllow] = useState('')
  const [block, setBlock] = useState('')
  const toast = useToast()
  useEffect(() => {
    if (cfg) {
      setAllow((cfg.oauthAllowedDomains ?? []).join(', '))
      setBlock((cfg.oauthBlockedDomains ?? []).join(', '))
    }
  }, [cfg])
  const save = async () => {
    try {
      await api('/api/v1/admin/settings', {
        method: 'PUT',
        body: { ...cfg, oauthAllowedDomains: allow, oauthBlockedDomains: block },
      })
      toast('s', '邮箱黑白名单已保存')
      reload()
    } catch (e: any) { toast('e', e.message) }
  }
  return (
    <div className="card form-card" style={{ marginTop: 16 }}>
      <h3 style={{ margin: '0 0 10px' }}>OAuth 注册邮箱白名单 / 黑名单</h3>
      <div className="hint" style={{ marginBottom: 12 }}>支持填写完整邮箱或域名（如 <span className="mono">company.com, user@example.com</span>），逗号分隔；黑名单优先于白名单，白名单留空表示不限制。</div>
      <div className="form-grid">
        <label className="field"><span>邮箱 / 域名白名单</span><input value={allow} onChange={e => setAllow(e.target.value)} placeholder="留空不限制，例如 gmail.com, company.com" /></label>
        <label className="field"><span>邮箱 / 域名黑名单</span><input value={block} onChange={e => setBlock(e.target.value)} placeholder="例如 temp-mail.org, spam@test.com" /></label>
      </div>
      <div className="form-actions"><button className="btn pri" onClick={save}><Save size={15} />保存规则</button></div>
    </div>
  )
}

export function Links() {
  const [d, reload] = useData<any>('/api/v1/admin/links', 3000)
  const toast = useToast()
  const drop = async (id: string) => { try { await api(`/api/v1/admin/links/${id}`, { method: 'DELETE' }); toast('s', '已断开'); reload() } catch (e: any) { toast('e', e.message) } }
  return (<>
    <Head title="实时连接" sub="Host ⇄ Client 的逻辑连接(每 3 秒刷新)" />
    <div className="card tablecard"><table><thead><tr><th>连接</th><th>Host</th><th>Client</th><th>阶段</th><th>传输</th><th>时长</th><th /></tr></thead><tbody>
      {d?.items?.map((l: any) => <tr key={l.id}><td data-label="连接" className="mono">{l.id.slice(0, 8)}</td><td data-label="Host" className="mono">{l.host.slice(0, 12)}</td><td data-label="Client" className="mono">{l.client.slice(0, 12)}</td>
        <td data-label="阶段"><Badge ok={l.stage === 'ready'}>{l.stage}</Badge></td><td data-label="传输">{l.preferredTransports.join(' / ')}</td><td data-label="时长" className="mono">{fmtDur(l.ageMs)}</td>
        <td><button className="btn sm danger" onClick={() => drop(l.id)}><XCircle size={13} />断开</button></td></tr>)}
    </tbody></table>{d && !d.items.length && <div className="empty">当前没有活动连接</div>}</div>
  </>)
}

export function Events() {
  const [d, reload] = useData<any>('/api/v1/admin/events', 10000)
  const [kind, setKind] = useState('')
  const toast = useToast()
  const clear = async () => { if (!confirm('清空全部审计日志?')) return; try { await api('/api/v1/admin/events', { method: 'DELETE' }); toast('s', '已清空'); reload() } catch (e: any) { toast('e', e.message) } }
  const items = (d?.items ?? []).filter((e: any) => !kind || String(e.type).includes(kind) || String(e.detail ?? '').includes(kind) || String(e.actor ?? '').includes(kind))
  const exportLogs = (fmt: 'json' | 'csv') => {
    const content = fmt === 'json'
      ? JSON.stringify(items, null, 2)
      : ['time,type,detail,actor', ...items.map((e: any) => [new Date(e.t).toISOString(), e.type, e.detail ?? '', e.actor ?? ''].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([content], { type: fmt === 'json' ? 'application/json' : 'text/csv' }))
    a.download = `dsh-audit-${Date.now()}.${fmt}`
    a.click()
  }
  return (<>
    <Head title="审计日志" sub="最近 200 条登录与管理操作">
      <input className="filter-input" placeholder="按事件/详情/账号筛选" value={kind} onChange={e => setKind(e.target.value)} />
      <button className="btn" onClick={() => exportLogs('json')}>导出 JSON</button>
      <button className="btn" onClick={() => exportLogs('csv')}>导出 CSV</button>
      <button className="btn" onClick={reload}><RefreshCw size={15} />刷新</button>
      <button className="btn danger" onClick={clear}><Trash2 size={15} />清空</button>
    </Head>
    <div className="card tablecard"><table><thead><tr><th>时间</th><th>事件</th><th>详情</th><th>操作者</th></tr></thead><tbody>
      {items.map((e: any, i: number) => <tr key={i}><td data-label="时间" className="mono">{new Date(e.t).toLocaleString()}</td><td data-label="事件">{e.type}</td><td data-label="详情" className="mono">{e.detail}</td><td data-label="操作者" className="mono">{e.actor}</td></tr>)}
    </tbody></table>{d && !items.length && <div className="empty">暂无记录</div>}</div>
  </>)
}

export function Turn() {
  const [d, reload] = useData<any>('/api/v1/admin/turn')
  const toast = useToast()
  const [mode, setMode] = useState<'token' | 'global'>('token')
  const [f, setF] = useState({ accountId: '', apiToken: '', email: '', apiKey: '', keyId: '', turnToken: '' })
  const [test, setTest] = useState<any>(null)
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })
  const auth = mode === 'token' ? { apiToken: f.apiToken } : { email: f.email, apiKey: f.apiKey }
  const run = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toast('s', ok); reload() } catch (e: any) { toast('e', e.message || e.code) } }
  return (<>
    <Head title="TURN 中转" sub="使用 Cloudflare Realtime TURN(每月 1,000GB 免费),让 P2P 失败时仍可低延迟中转" />
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,280px),1fr))' }}>
      <div className="card"><h3>当前状态</h3>
        <div className="row"><Badge ok={!!d?.configured}>{d?.configured ? `已配置(${d.source === 'env' ? '环境变量' : '后台'})` : '未配置'}</Badge></div>
        <p className="hint">Key ID:{d?.keyId ?? '-'}</p>
        <div className="row"><button className="btn" onClick={async () => { try { setTest(await api('/api/v1/admin/turn/test', { body: {} })) } catch (e: any) { toast('e', e.message) } }}><CheckCircle2 size={15} />测试签发凭据</button>
          {d?.source === 'dashboard' && <button className="btn danger" onClick={() => run(() => api('/api/v1/admin/turn', { method: 'DELETE' }), '已清除')}><Trash2 size={15} />清除</button>}</div>
        {test && <p className="hint" style={{ color: test.turn ? 'var(--ok)' : 'var(--bad)' }}>{test.turn ? `成功:返回 ${test.servers.length} 组服务器` : `失败:${test.error ?? '未配置 TURN'}`}</p>}
      </div>
      <div className="card"><h3>手动填入已有 Key</h3>
        <div className="field"><label>TURN Key ID</label><input value={f.keyId} onChange={set('keyId')} /></div>
        <div className="field"><label>TURN API Token</label><input type="password" value={f.turnToken} onChange={set('turnToken')} /></div>
        <button className="btn" disabled={!f.keyId || !f.turnToken} onClick={() => run(() => api('/api/v1/admin/turn/manual', { body: { keyId: f.keyId, apiToken: f.turnToken } }), '已保存')}><Save size={15} />保存</button></div>
    </div>
    <div className="card"><h3><Cloud size={15} />一键创建 TURN Key</h3>
      <p className="hint" style={{ marginBottom: 14 }}>凭据只用于本次调用 Cloudflare API(POST /accounts/&#123;id&#125;/calls/turn_keys),不会被保存。需要 Realtime/Calls 编辑权限。</p>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className={`btn ${mode === 'token' ? 'pri' : ''}`} onClick={() => setMode('token')}>API Token</button>
        <button className={`btn ${mode === 'global' ? 'pri' : ''}`} onClick={() => setMode('global')}>Global API Key</button></div>
      <div className="form2">
        <div className="field"><label>Account ID</label><input value={f.accountId} onChange={set('accountId')} placeholder="32 位十六进制" /></div>
        {mode === 'token' ? <div className="field"><label>API Token</label><input type="password" value={f.apiToken} onChange={set('apiToken')} /></div> : <>
          <div className="field"><label>邮箱</label><input value={f.email} onChange={set('email')} /></div>
          <div className="field"><label>Global API Key</label><input type="password" value={f.apiKey} onChange={set('apiKey')} /></div></>}
      </div>
      <button className="btn pri" disabled={!f.accountId} onClick={() => run(() => api('/api/v1/admin/turn/provision', { body: { accountId: f.accountId, ...auth } }), 'TURN Key 已创建并启用')}>创建并启用</button>
    </div>
  </>)
}

const FIELDS: { key: string; label: string; hint: string; type: 'num' | 'bool' | 'text' }[] = [
  { key: 'siteName', label: '站点名称', hint: '显示在后台标题', type: 'text' },
  { key: 'sessionHours', label: '后台登录有效期(小时)', hint: '1–720', type: 'num' },
  { key: 'p2pEnabled', label: '打开 P2P', hint: '默认开启。允许设备间协商 WebRTC P2P 直连；关闭后仅走 TURN / Relay', type: 'bool' },
  { key: 'stunEnabled', label: '打开 STUN', hint: '默认开启。用于 P2P NAT 打洞，关闭后不下发任何 STUN（含 TURN 凭据自带的）', type: 'bool' },
  { key: 'maxEnabledStun', label: 'STUN 同时启用上限', hint: '1–16（默认 6）。过多或不可达 STUN 会拖慢 ICE 收集超 12 秒并退回 Relay', type: 'num' },
  { key: 'turnEnabled', label: '启用 TURN', hint: '默认开启。P2P 打洞失败时签发 Cloudflare TURN 中继凭据', type: 'bool' },
  { key: 'turnTtlSeconds', label: 'TURN 凭据有效期(秒)', hint: '60–3600', type: 'num' },
  { key: 'heartbeatMs', label: '心跳间隔(ms)', hint: '服务端 ping 周期，5000–120000', type: 'num' },
  { key: 'heartbeatDisconnectMs', label: '心跳断线阈值(ms)', hint: '超过该时间无 pong 则断开，需 ≥ 2×心跳', type: 'num' },
  { key: 'helloTimeoutMs', label: 'Hello 握手超时(ms)', hint: '连接后必须在此时间内认证', type: 'num' },
  { key: 'maxFramesPerSec', label: '单连接每秒帧数上限', hint: '超限返回 RATE_LIMITED', type: 'num' },
  { key: 'maxConnections', label: 'WebSocket 并发上限', hint: '8–1024', type: 'num' },
  { key: 'maxDevicesPerAccount', label: '每账号设备上限', hint: '1–4096', type: 'num' },
]

export function SettingsPage() {
  const [d, reload] = useData<any>('/api/v1/admin/settings')
  const toast = useToast()
  const [s, setS] = useState<any>(null)
  const [stunUrl, setStunUrl] = useState(''), [stunLabel, setStunLabel] = useState('')
  const [stunFilter, setStunFilter] = useState<'all' | 'on' | 'off'>('all')
  const [originInput, setOriginInput] = useState('')
  useEffect(() => { if (d) setS(d.settings) }, [d])
  if (!s) return null
  const dirty = Boolean(d?.settings && JSON.stringify(s) !== JSON.stringify(d.settings))

  const onChange = (k: string, t: string, v: any) => setS({ ...s, [k]: t === 'num' ? Number(v) : v })
  const save = async (body: any) => {
    try {
      const r = await api<any>('/api/v1/admin/settings', { method: 'PUT', body })
      if (r.settings) setS(r.settings)
      toast('s', '设置已生效')
      reload()
    } catch (e: any) { toast('e', e.message) }
  }

  const stuns: any[] = s.stunServers ?? []
  const maxStun = Math.max(1, Math.min(16, Number(s.maxEnabledStun) || 6))
  const enabledStunCount = stuns.filter(x => x.enabled).length
  const filteredStuns = stuns
    .map((x, idx) => ({ ...x, idx }))
    .filter(x => stunFilter === 'all' || (stunFilter === 'on' ? x.enabled : !x.enabled))

  const addStun = () => {
    const url = stunUrl.trim()
    if (!/^stuns?:[^\s]+$/i.test(url)) { toast('e', '请输入有效的 stun: 或 stuns: 地址'); return }
    if (stuns.some(x => x.url.toLowerCase() === url.toLowerCase())) { toast('e', '该 STUN 地址已存在'); return }
    if (stuns.length >= 64) { toast('e', '最多保留 64 条 STUN'); return }
    const enabled = enabledStunCount < maxStun
    if (!enabled) toast('e', `已达同时启用上限（${maxStun} 条），已添加为禁用状态`)
    setS({ ...s, stunServers: [{ url, label: stunLabel.trim() || '自定义', region: '自定义', enabled }, ...stuns] })
    setStunUrl(''); setStunLabel('')
  }
  const toggleStun = (idx: number) => {
    const cur = stuns[idx]
    if (cur && !cur.enabled && enabledStunCount >= maxStun) {
      toast('e', `最多同时启用 ${maxStun} 条 STUN，请先禁用其他条目或调大上限`)
      return
    }
    setS({ ...s, stunServers: stuns.map((x, i) => i === idx ? { ...x, enabled: !x.enabled } : x) })
  }
  const delStun = (idx: number) => setS({ ...s, stunServers: stuns.filter((_, i) => i !== idx) })
  const setAllStun = (enabled: boolean) => setS({ ...s, stunServers: stuns.map(x => ({ ...x, enabled })) })
  const enableRecommended = () => {
    let n = 0
    setS({ ...s, stunServers: stuns.map(x => ({ ...x, enabled: String(x.region || '').includes('推荐') && n++ < maxStun })) })
  }
  const resetStunList = () => setS({ ...s, stunServers: d?.defaultStun ?? d?.defaults?.stunServers ?? [] })

  const origins: { origin: string; enabled: boolean }[] = s.originRules ?? []
  const addOrigin = () => {
    const origin = originInput.trim().replace(/\/+$/, '')
    if (!/^https?:\/\/[^\s/]+$/i.test(origin)) { toast('e', '请输入合法的 Origin（如 https://dsh.example.com）'); return }
    if (origins.some(x => x.origin.toLowerCase() === origin.toLowerCase())) { toast('e', '该 Origin 已存在'); return }
    if (origins.length >= 32) { toast('e', '最多保留 32 条 Origin'); return }
    setS({ ...s, originRules: [...origins, { origin, enabled: true }] })
    setOriginInput('')
  }
  const toggleOrigin = (idx: number) => setS({ ...s, originRules: origins.map((x, i) => i === idx ? { ...x, enabled: !x.enabled } : x) })
  const delOrigin = (idx: number) => setS({ ...s, originRules: origins.filter((_, i) => i !== idx) })

  return (<>
    <Head title="系统设置" sub="默认值来自 wrangler.jsonc 的 vars(DSH_*);修改后点右上角「保存」即时生效">
      <button className="btn" onClick={() => save(d.defaults)}>恢复环境变量默认值</button>
      <button className="btn pri" onClick={() => save(s)}><Save size={15} />保存</button>
    </Head>

    <div className="card" style={{ marginBottom: 16 }}>
      <h3>基础与传输开关</h3>
      <div className="form2">
        {FIELDS.map(f => <div className="field" key={f.key}><label>{f.label}</label>
          {f.type === 'bool' ? <button className={`toggle ${s[f.key] ? 'on' : ''}`} onClick={() => onChange(f.key, 'bool', !s[f.key])} />
            : <input type={f.type === 'num' ? 'number' : 'text'} value={s[f.key] ?? ''} onChange={e => onChange(f.key, f.type, e.target.value)} />}
          <p className="hint">{f.hint}</p></div>)}
      </div>
    </div>

    <div className="card" style={{ marginBottom: 16 }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}><Cloud size={15} />公共与自定义 STUN 列表（用于 P2P 打洞）</h3>
        <span className={`badge ${s.stunEnabled ? 'ok' : 'warn'}`}><i />{s.stunEnabled ? `已启用 ${enabledStunCount} / 上限 ${maxStun}（共 ${stuns.length}）` : 'STUN 总开关已关闭'}</span>
      </div>
      <p className="hint" style={{ marginBottom: 10 }}>
        STUN 仅用于 WebRTC <strong>P2P</strong> 建连阶段的 NAT 公网地址探测（不中转流量）；打洞失败后将由 TURN 或 Relay 接管。支持在下方卡片单独启用、禁用、删除或新增。
      </p>
      <div className="add-bar">
        <input placeholder="新增 STUN 地址，如 stun:stun.miwifi.com:3478" value={stunUrl} onChange={e => setStunUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && addStun()} />
        <input className="short" placeholder="备注（可选）" value={stunLabel} onChange={e => setStunLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && addStun()} />
        <button className="btn pri" onClick={addStun}><Plus size={15} />添加</button>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <div className="seg">
          {(['all', 'on', 'off'] as const).map(k => (
            <button key={k} className={`btn sm ${stunFilter === k ? 'pri' : ''}`} onClick={() => setStunFilter(k)}>
              {k === 'all' ? `全部 (${stuns.length})` : k === 'on' ? `已启用 (${enabledStunCount})` : `已禁用 (${stuns.length - enabledStunCount})`}
            </button>
          ))}
        </div>
        <div className="row right">
          <button className="btn sm" onClick={enableRecommended}>仅启用推荐</button>
          <button className="btn sm" onClick={() => setAllStun(false)}>全部禁用</button>
          <button className="btn sm" onClick={resetStunList}>恢复默认列表</button>
        </div>
      </div>
      {filteredStuns.length ? (
        <div className="srv-grid">
          {filteredStuns.map(item => (
            <div key={item.url} className={`srv-card ${item.enabled && s.stunEnabled ? '' : 'off'}`}>
              <div className="srv-top">
                <div className="srv-title">
                  <span>{item.label || (item.builtin ? '公共 STUN' : '自定义')}</span>
                  <span className={`badge ${item.builtin ? '' : 'ok'}`}>{item.region || (item.builtin ? '内置' : '自定义')}</span>
                </div>
                <div className="srv-actions">
                  <button className={`toggle ${item.enabled ? 'on' : ''}`} title={item.enabled ? '点击禁用' : '点击启用'} onClick={() => toggleStun(item.idx)} />
                  <button className="icon-btn" title="删除" onClick={() => delStun(item.idx)}><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="srv-url">{item.url}</div>
            </div>
          ))}
        </div>
      ) : <div className="empty">暂无 STUN 服务器，可在上方添加或点击「恢复默认列表」</div>}
    </div>

    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}>额外允许的 Origin 白名单</h3>
        <span className="badge"><i />已启用 {origins.filter(x => x.enabled).length} / {origins.length}</span>
      </div>
      <p className="hint" style={{ marginBottom: 10 }}>自定义域名与访问域名相同时无需填写；仅在需要额外允许跨域 Origin 访问时添加（如 https://dsh.example.com）。</p>
      <div className="add-bar">
        <input placeholder="输入 Origin，如 https://dsh.example.com" value={originInput} onChange={e => setOriginInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addOrigin()} />
        <button className="btn pri" onClick={addOrigin}><Plus size={15} />添加</button>
      </div>
      {origins.length ? (
        <div className="srv-grid">
          {origins.map((item, idx) => (
            <div key={item.origin} className={`srv-card ${item.enabled ? '' : 'off'}`}>
              <div className="srv-top">
                <span className={`badge ${item.enabled ? 'ok' : ''}`}><i />{item.enabled ? '已启用' : '已禁用'}</span>
                <div className="srv-actions">
                  <button className={`toggle ${item.enabled ? 'on' : ''}`} title={item.enabled ? '点击禁用' : '点击启用'} onClick={() => toggleOrigin(idx)} />
                  <button className="icon-btn" title="删除" onClick={() => delOrigin(idx)}><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="srv-url">{item.origin}</div>
            </div>
          ))}
        </div>
      ) : <div className="empty" style={{ padding: '18px 0 6px' }}>未配置额外 Origin（默认仅允许同源访问）</div>}
    </div>
    {dirty && (
      <div className="save-bar">
        <span className="badge warn"><i />有未保存的更改</span>
        <div className="row right">
          <button className="btn sm" onClick={() => setS(d.settings)}>撤销</button>
          <button className="btn pri sm" onClick={() => save(s)}><Save size={14} />立即保存</button>
        </div>
      </div>
    )}
  </>)
}


export function InvitesPage() {
  const [d, reload] = useData<any>('/api/v1/admin/invites', 15000)
  const [code, setCode] = useState('')
  const [count, setCount] = useState('1')
  const [maxUses, setMaxUses] = useState('1')
  const [expiresHours, setExpiresHours] = useState('168')
  const [note, setNote] = useState('')
  const [sel, setSel] = useState<string[]>([])
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'used' | 'expired'>('all')
  const [detail, setDetail] = useState<any | null>(null)
  const toast = useToast()
  const now = Date.now()
  const getStatus = (x: any): 'active' | 'used' | 'expired' =>
    x.uses >= x.maxUses ? 'used' : (x.expiresAt > 0 && x.expiresAt <= now) ? 'expired' : 'active'
  const statusLabel: Record<'active' | 'used' | 'expired', string> = { active: '可用', used: '已用完', expired: '已过期' }
  const allItems: any[] = d?.items ?? []
  const items = allItems.filter(x => statusFilter === 'all' || getStatus(x) === statusFilter)
  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const n = Math.max(1, Math.min(100, Number(count) || 1))
      const r = await api('/api/v1/admin/invites', {
        method: 'POST',
        body: {
          ...(n === 1 && code.trim() ? { code: code.trim() } : {}),
          count: n,
          maxUses: Math.max(1, Number(maxUses) || 1),
          ...(Number(expiresHours) > 0 ? { expiresHours: Number(expiresHours) } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      })
      toast('s', n > 1 ? `已批量生成 ${r.count} 个邀请码` : `已生成邀请码: ${r.code}`)
      setCode(''); setNote('')
      reload()
    } catch (err: any) { toast('e', err.message) }
  }
  const del = async (c: string) => {
    try { await api(`/api/v1/admin/invites/${encodeURIComponent(c)}`, { method: 'DELETE' }); toast('s', '已删除'); setSel(s => s.filter(x => x !== c)); reload() } catch (err: any) { toast('e', err.message) }
  }
  const batchDel = async (expired = false) => {
    if (!expired && !sel.length) return
    if (!confirm(expired ? '清理所有已过期或已用完的邀请码?' : `删除选中的 ${sel.length} 个邀请码?`)) return
    try {
      const r = await api('/api/v1/admin/invites/batch-delete', { method: 'POST', body: expired ? { expired: true } : { codes: sel } })
      toast('s', `已清理 ${r.removed} 个邀请码`)
      if (!expired) setSel([])
      reload()
    } catch (err: any) { toast('e', err.message) }
  }
  const copyCodes = (list: any[]) => {
    if (!list.length) { toast('e', '没有可复制的邀请码'); return }
    navigator.clipboard.writeText(list.map(x => x.code).join('\n'))
    toast('s', `已复制 ${list.length} 个邀请码`)
  }
  const exportInvites = (fmt: 'csv' | 'txt' | 'json') => {
    const list = sel.length ? items.filter(x => sel.includes(x.code)) : items
    if (!list.length) { toast('e', '暂无可导出的邀请码'); return }
    const content = fmt === 'txt'
      ? list.map(x => x.code).join('\n')
      : fmt === 'json'
        ? JSON.stringify(list.map(x => ({ ...x, status: statusLabel[getStatus(x)] })), null, 2)
        : ['code,status,uses,maxUses,usedBy,expiresAt,note', ...list.map(x => [
            x.code, statusLabel[getStatus(x)], x.uses, x.maxUses,
            (x.usedBy ?? []).map((u: any) => `${u.email}(${new Date(u.at).toISOString()})`).join('; '),
            x.expiresAt ? new Date(x.expiresAt).toISOString() : 'never', x.note ?? '',
          ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
    a.download = `dsh-invites-${Date.now()}.${fmt}`
    a.click()
  }
  const allChecked = items.length > 0 && sel.length === items.length
  return (<>
    <Head title="邀请码管理" sub="支持单个/批量生成、状态筛选、使用明细查看与多格式导出">
      <button className="btn" onClick={() => copyCodes(sel.length ? items.filter(x => sel.includes(x.code)) : items.filter(x => getStatus(x) === 'active'))}>复制{sel.length ? '选中' : '可用'}</button>
      <button className="btn" onClick={() => exportInvites('txt')}>导出 TXT</button>
      <button className="btn" onClick={() => exportInvites('csv')}>导出 CSV</button>
      <button className="btn" onClick={() => exportInvites('json')}>导出 JSON</button>
      {sel.length > 0 && <button className="btn danger" onClick={() => batchDel(false)}>删除选中 ({sel.length})</button>}
      <button className="btn danger" onClick={() => batchDel(true)}>清理已失效</button>
      <button className="btn" onClick={reload}><RefreshCw size={15} />刷新</button>
    </Head>
    <form className="card form-card" onSubmit={create} style={{ marginBottom: 16 }}>
      <div className="form-grid">
        <label className="field"><span>生成数量（1-100）</span><input type="number" min={1} max={100} value={count} onChange={e => setCount(e.target.value)} /></label>
        {Number(count) <= 1 && <label className="field"><span>自定义邀请码（留空随机）</span><input value={code} onChange={e => setCode(e.target.value)} placeholder="例如 TEAM2026" /></label>}
        <label className="field"><span>最大使用次数</span><input type="number" min={1} max={1000} value={maxUses} onChange={e => setMaxUses(e.target.value)} /></label>
        <label className="field"><span>有效期（小时，0 为永久）</span><input type="number" min={0} max={8760} value={expiresHours} onChange={e => setExpiresHours(e.target.value)} /></label>
        <label className="field"><span>备注</span><input value={note} onChange={e => setNote(e.target.value)} placeholder="可选备注" /></label>
      </div>
      <div className="form-actions"><button className="btn primary" type="submit">{Number(count) > 1 ? `批量生成 ${count} 个` : '生成邀请码'}</button></div>
    </form>
    <div className="row" style={{ gap: 8, marginBottom: 12 }}>
      {([['all', '全部'], ['active', '可用'], ['used', '已用完'], ['expired', '已过期']] as const).map(([k, lbl]) => (
        <button key={k} type="button" className={`btn sm ${statusFilter === k ? 'pri' : ''}`} onClick={() => { setStatusFilter(k); setSel([]) }}>{lbl}</button>
      ))}
    </div>
    {detail && (
      <div className="card form-card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <strong>邀请码 <span className="mono">{detail.code}</span> 使用记录</strong>
          <button className="btn sm" onClick={() => setDetail(null)}>关闭</button>
        </div>
        {(detail.usedBy ?? []).length ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {detail.usedBy.map((u: any, i: number) => <li key={i} className="mono">{u.email} · {new Date(u.at).toLocaleString()}</li>)}
          </ul>
        ) : <div className="hint">暂无详细使用记录（旧版本核销的记录未记录邮箱）</div>}
      </div>
    )}
    <div className="card tablecard"><table><thead><tr>
      <th style={{ width: 36 }}><input type="checkbox" checked={allChecked} onChange={e => setSel(e.target.checked ? items.map(x => x.code) : [])} /></th>
      <th>邀请码</th><th>状态</th><th>已用 / 上限</th><th>使用用户</th><th>有效期</th><th>备注</th><th>操作</th>
    </tr></thead><tbody>
      {items.map((x: any) => {
        const st = getStatus(x)
        const ub: any[] = x.usedBy ?? []
        return (
          <tr key={x.code}>
            <td><input type="checkbox" checked={sel.includes(x.code)} onChange={e => setSel(s => e.target.checked ? [...s, x.code] : s.filter(k => k !== x.code))} /></td>
            <td data-label="邀请码" className="mono">{x.code}</td>
            <td data-label="状态"><span className={`badge ${st === 'active' ? 'ok' : st === 'expired' ? 'bad' : ''}`}>{statusLabel[st]}</span></td>
            <td data-label="已用 / 上限">{x.uses} / {x.maxUses}</td>
            <td data-label="使用用户">{ub.length ? <button className="btn sm" onClick={() => setDetail(x)}>{ub[0].email}{ub.length > 1 ? ` +${ub.length - 1}` : ''}</button> : <span className="hint">-</span>}</td>
            <td data-label="有效期" className="mono">{x.expiresAt ? new Date(x.expiresAt).toLocaleString() : '永久有效'}</td>
            <td data-label="备注">{x.note || '-'}</td>
            <td data-label="操作"><div className="row">
              <button className="btn sm" onClick={() => copyCodes([x])}>复制</button>
              <button className="btn sm danger" onClick={() => del(x.code)}>删除</button>
            </div></td>
          </tr>
        )
      })}
    </tbody></table>{d && !items.length && <div className="empty">暂无符合条件的邀请码</div>}</div>
  </>)
}

function detectWebhookPlatform(url: string): { id: string; name: string } {
  const u = url.toLowerCase()
  if (u.includes('open.feishu.cn') || u.includes('open.larksuite.com')) return { id: 'feishu', name: '飞书 / Lark' }
  if (u.includes('oapi.dingtalk.com')) return { id: 'dingtalk', name: '钉钉机器人' }
  if (u.includes('qyapi.weixin.qq.com')) return { id: 'wecom', name: '企业微信' }
  if (u.includes('discord.com/api/webhooks')) return { id: 'discord', name: 'Discord' }
  return { id: 'custom', name: '通用 Webhook' }
}

function WebhookIcon({ id }: { id: string }) {
  if (id === 'discord') return <ProviderIcon id="discord" size={16} />
  if (id === 'feishu') return <svg width="16" height="16" viewBox="0 0 24 24" fill="#3370FF" aria-hidden="true"><path d="M3 4l18 4-7 5 4 7-15-9 6-2z"/></svg>
  if (id === 'dingtalk') return <svg width="16" height="16" viewBox="0 0 24 24" fill="#0089FF" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm4.6 10.6-3.1 1.4 1.3 3.5-5.4-5.2 3-1.3-1.2-3.6z"/></svg>
  if (id === 'wecom') return <svg width="16" height="16" viewBox="0 0 24 24" fill="#07C160" aria-hidden="true"><path d="M9.5 4C5.36 4 2 6.8 2 10.25c0 1.96 1.09 3.7 2.79 4.85L4 17.5l2.74-1.37c.86.24 1.79.37 2.76.37 4.14 0 7.5-2.8 7.5-6.25S13.64 4 9.5 4z"/></svg>
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
}

export function ProfilePage() {
  const [p, reload] = useData<any>('/api/v1/account/profile', 15000)
  const [codes, reloadCodes] = useData<any>('/api/v1/account/host-registration-codes', 10000)
  const [wh, reloadWh] = useData<any>('/api/v1/account/webhooks')
  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [whName, setWhName] = useState('')
  const [whUrl, setWhUrl] = useState('')
  const [whEvents, setWhEvents] = useState<string[]>(['host_offline', 'device_registered'])
  const [whDevs, setWhDevs] = useState('')
  const toast = useToast()
  const savePw = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api('/api/v1/account/password', { method: 'POST', body: { currentPassword: curPw, newPassword: newPw } })
      toast('s', '密码已更新'); setCurPw(''); setNewPw(''); reload()
    } catch (err: any) { toast('e', err.message) }
  }
  const revokeSes = async (id: string) => {
    try { await api(`/api/v1/account/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }); toast('s', '已踢下线'); reload() } catch (err: any) { toast('e', err.message) }
  }
  const genCode = async () => {
    try { const r = await api('/api/v1/account/host-registration-codes', { method: 'POST', body: {} }); toast('s', `已生成匹配码: ${r.code}`); reloadCodes() } catch (err: any) { toast('e', err.message) }
  }
  const delCode = async (id: string) => {
    try { await api(`/api/v1/account/host-registration-codes/${encodeURIComponent(id)}`, { method: 'DELETE' }); toast('s', '已作废'); reloadCodes() } catch (err: any) { toast('e', err.message) }
  }
  const addWh = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api('/api/v1/account/webhooks', {
        method: 'POST',
        body: { name: whName.trim() || detectWebhookPlatform(whUrl).name, url: whUrl.trim(), enabled: true, events: whEvents, deviceIds: whDevs.split(',').map(s => s.trim()).filter(Boolean) },
      })
      toast('s', '已添加 Webhook'); setWhName(''); setWhUrl(''); setWhDevs(''); reloadWh()
    } catch (err: any) { toast('e', err.message) }
  }
  const toggleWh = async (item: any) => {
    try { await api('/api/v1/account/webhooks', { method: 'POST', body: { ...item, enabled: !item.enabled } }); reloadWh() } catch (err: any) { toast('e', err.message) }
  }
  const delWh = async (id: string) => {
    try { await api(`/api/v1/account/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' }); toast('s', '已删除'); reloadWh() } catch (err: any) { toast('e', err.message) }
  }
  const testWh = async (id: string) => {
    try { const r = await api('/api/v1/account/webhooks/test', { method: 'POST', body: { id } }); toast('s', `发送成功 (HTTP ${r.status ?? 200})`) }
    catch (err: any) { toast('e', String(err.message).includes('internal error') ? 'Webhook 请求失败：目标地址无法连接或超时' : err.message) }
  }
  return (<>
    <Head title="个人中心" sub="管理个人密码、活跃会话、主机匹配码与 Webhook 告警" />
    <div className="card form-card" style={{ marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 12px' }}>账号信息与密码</h3>
      <div className="hint" style={{ marginBottom: 12 }}>当前账号: <span className="mono">{p?.email ?? '-'}</span> · 设备配额: {p?.maxDevices ?? '-'} 台</div>
      <form onSubmit={savePw}>
        <div className="form-grid">
          {p?.hasPassword && <label className="field"><span>当前密码</span><input type="password" value={curPw} onChange={e => setCurPw(e.target.value)} required /></label>}
          <label className="field"><span>{p?.hasPassword ? '新密码（≥12 位）' : '设置初始密码（≥12 位）'}</span><input type="password" minLength={12} value={newPw} onChange={e => setNewPw(e.target.value)} required /></label>
        </div>
        <div className="form-actions"><button className="btn primary" type="submit">{p?.hasPassword ? '修改密码' : '设置密码'}</button></div>
      </form>
    </div>
    <div className="card form-card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>主机匹配码 (XXXX-XXXX)</h3>
        <button className="btn primary" onClick={genCode}>生成匹配码</button>
      </div>
      <table><thead><tr><th>匹配码</th><th>过期时间</th><th>操作</th></tr></thead><tbody>
        {(codes?.items ?? []).map((c: any) => (
          <tr key={c.registrationId}><td className="mono">{c.code}</td><td className="mono">{new Date(c.expiresAt).toLocaleString()}</td><td><button className="btn danger" onClick={() => delCode(c.registrationId)}>作废</button></td></tr>
        ))}
      </tbody></table>
    </div>
    <div className="card form-card" style={{ marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 12px' }}>活跃登录会话</h3>
      <table><thead><tr><th>会话 ID</th><th>设备 / UA</th><th>过期时间</th><th>操作</th></tr></thead><tbody>
        {(p?.sessions ?? []).map((s: any) => (
          <tr key={s.id}><td className="mono">{s.id}</td><td className="mono">{s.ua || 'Web / Client'}</td><td className="mono">{new Date(s.expires).toLocaleString()}</td><td><button className="btn danger" onClick={() => revokeSes(s.id)}>踢下线</button></td></tr>
        ))}
      </tbody></table>
    </div>
    <div className="card form-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Webhook 离线与新设备告警</h3>
        {whUrl && (() => { const plat = detectWebhookPlatform(whUrl); return <span className="row" style={{ gap: 6, fontSize: 13, opacity: 0.9 }}><WebhookIcon id={plat.id} />{plat.name}</span> })()}
      </div>
      <form onSubmit={addWh} style={{ marginBottom: 16 }}>
        <div className="form-grid">
          <label className="field"><span>名称（可选）</span><input value={whName} onChange={e => setWhName(e.target.value)} placeholder="例如 飞书告警群" /></label>
          <label className="field"><span>Webhook URL（自动识别平台）</span><input value={whUrl} onChange={e => setWhUrl(e.target.value)} placeholder="https://..." required /></label>
          <label className="field"><span>指定监控设备 ID（留空监控全部）</span><input value={whDevs} onChange={e => setWhDevs(e.target.value)} placeholder="留空监控全部设备" /></label>
          <label className="field"><span>主机离线告警</span><div><button type="button" className={`toggle ${whEvents.includes('host_offline') ? 'on' : ''}`} onClick={() => setWhEvents(ev => ev.includes('host_offline') ? ev.filter(x => x !== 'host_offline') : [...ev, 'host_offline'])} /></div></label>
          <label className="field"><span>新设备接入告警</span><div><button type="button" className={`toggle ${whEvents.includes('device_registered') ? 'on' : ''}`} onClick={() => setWhEvents(ev => ev.includes('device_registered') ? ev.filter(x => x !== 'device_registered') : [...ev, 'device_registered'])} /></div></label>
        </div>
        <div className="form-actions"><button className="btn primary" type="submit">添加 Webhook</button></div>
      </form>
      <div className="tablecard"><table><thead><tr><th>平台 / 名称</th><th>URL</th><th>启用</th><th>操作</th></tr></thead><tbody>
        {(wh?.items ?? []).map((item: any) => {
          const plat = detectWebhookPlatform(item.url)
          return (
            <tr key={item.id}>
              <td data-label="平台 / 名称"><span className="row" style={{ gap: 8 }}><WebhookIcon id={plat.id} />{item.name || plat.name}</span></td>
              <td data-label="URL" className="mono" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.url}</td>
              <td data-label="启用"><button type="button" className={`toggle ${item.enabled ? 'on' : ''}`} onClick={() => toggleWh(item)} /></td>
              <td data-label="操作"><div className="row">
                <button type="button" className="btn sm" onClick={() => testWh(item.id)}>测试</button>
                <button type="button" className="btn sm danger" onClick={() => delWh(item.id)}>删除</button>
              </div></td>
            </tr>
          )
        })}
      </tbody></table></div>
    </div>
  </>)
}

export function NetworkPage() {
  const [pingMs, setPingMs] = useState<number | null>(null)
  const [iceStatus, setIceStatus] = useState<string>('未测试')
  const [testing, setTesting] = useState(false)
  const runTest = async () => {
    setTesting(true); setIceStatus('探测中...')
    try {
      const t0 = performance.now()
      const r = await api('/api/v1/network/ping')
      setPingMs(Math.round(performance.now() - t0))
      const urls: string[] = r.stunServers ?? []
      if (!urls.length || typeof RTCPeerConnection === 'undefined') {
        setIceStatus('未配置 STUN 或当前浏览器不支持 WebRTC'); setTesting(false); return
      }
      const pc = new RTCPeerConnection({ iceServers: [{ urls }] })
      pc.createDataChannel('probe')
      let found = 0
      pc.onicecandidate = e => { if (e.candidate) found++ }
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      setTimeout(() => {
        pc.close()
        setIceStatus(found > 0 ? `正常（收集到 ${found} 个 ICE 候选）` : '未收集到 ICE 候选，请检查网络或 TURN')
        setTesting(false)
      }, 2500)
    } catch (err: any) {
      setIceStatus(`测试失败: ${err.message}`); setTesting(false)
    }
  }
  return (<>
    <Head title="网络与连通性诊断" sub="检测中继服务器延迟与 WebRTC STUN/ICE 穿透能力">
      <button className="btn primary" onClick={runTest} disabled={testing}>{testing ? '诊断中...' : '开始诊断'}</button>
    </Head>
    <div className="card form-card">
      <div style={{ marginBottom: 12 }}>Relay API 延迟: <span className="mono">{pingMs !== null ? `${pingMs} ms` : '未测试'}</span></div>
      <div>WebRTC STUN / ICE 状态: <span className="mono">{iceStatus}</span></div>
    </div>
  </>)
}
