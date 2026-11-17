import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Ban, CheckCircle2, Cloud, Copy, Cpu, KeyRound, Pencil, Plug, Plus, RefreshCw, Save, Search, Trash2, Unplug, Users as UsersIcon, XCircle } from 'lucide-react'
import { api, fmtAgo, fmtDur } from './api'
import { useToast } from './toast'

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
        <p className="hint" style={{ fontSize: 13 }}>心跳 {Math.round((d.config?.heartbeatMs ?? 25000) / 1000)}s · WS 上限 {d.config?.maxConnections ?? 256} · TURN TTL {d.config?.turnTtlSeconds ?? 300}s</p>
        <p className="hint" style={{ fontSize: 13 }}>Workers 免费版每日 10 万请求、DO 13,000 GB-s，启用 Hibernation 空闲不计时。</p>
        <div className="bar"><div style={{ width: `${Math.min(100, d.sockets * 4)}%` }} /></div></div>
    </div>
  </>)
}

export function MyDevices() {
  const [d, reload] = useData<any>('/api/v1/account/devices', 8000)
  const toast = useToast()
  const [pw, setPw] = useState({ oldPassword: '', newPassword: '' })
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
    try { await api('/api/v1/account/password', { body: pw }); toast('s', '密码已修改'); setPw({ oldPassword: '', newPassword: '' }) } catch (e: any) { toast('e', e.code === 'AUTH_INVALID' ? '原密码错误' : e.message) }
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
      <div className="form2"><div className="field"><label>原密码</label><input type="password" value={pw.oldPassword} onChange={e => setPw({ ...pw, oldPassword: e.target.value })} /></div>
        <div className="field"><label>新密码(≥12 位)</label><input type="password" value={pw.newPassword} onChange={e => setPw({ ...pw, newPassword: e.target.value })} /></div></div>
      <button className="btn pri" disabled={!pw.oldPassword || pw.newPassword.length < 12} onClick={changePw}><Save size={15} />更新密码</button></div>
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
  const save = async () => {
    try { await api('/api/v1/admin/accounts', { body: { email, password } }); toast('s', '账号已保存'); setEmail(''); setPassword(''); reload() } catch (e: any) { toast('e', e.code === 'INVALID_MESSAGE' ? '密码至少 12 位' : e.message) }
  }
  const del = async (e: string) => { if (!confirm(`删除账号 ${e} 及其全部设备?`)) return; try { await api(`/api/v1/admin/accounts/${encodeURIComponent(e)}`, { method: 'DELETE' }); toast('s', '已删除'); reload() } catch (x: any) { toast('e', x.message) } }
  return (<>
    <Head title="账号管理" sub="多账号隔离:每个账号只能连接自己的 Host。再次提交同邮箱即重置密码。" />
    <div className="card" style={{ marginBottom: 16 }}><h3><Plus size={15} />新增 / 重置密码</h3>
      <div className="form2"><div className="field"><label>邮箱</label><input value={email} onChange={e => setEmail(e.target.value)} /></div>
        <div className="field"><label>密码(≥12 位)</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} /></div></div>
      <button className="btn pri" disabled={!email || password.length < 12} onClick={save}><Save size={15} />保存</button></div>
    <div className="card tablecard"><table><thead><tr><th>账号</th><th>设备</th><th>在线</th><th /></tr></thead><tbody>
      {d?.items?.map((a: any) => <tr key={a.email}><td data-label="账号">{a.email} {a.admin && <span className="badge warn"><i />管理员</span>}</td><td data-label="设备">{a.devices}</td><td data-label="在线">{a.online}</td>
        <td style={{ textAlign: 'right' }}><button className="btn sm danger" onClick={() => del(a.email)}><Trash2 size={13} />删除</button></td></tr>)}
    </tbody></table></div>
  </>)
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
  const clear = async () => { if (!confirm('清空全部审计日志?')) return; await api('/api/v1/admin/events', { method: 'DELETE' }); toast('s', '已清空'); reload() }
  const items = (d?.items ?? []).filter((e: any) => !kind || String(e.type).includes(kind))
  return (<>
    <Head title="审计日志" sub="最近 200 条登录与管理操作">
      <input className="filter-input" placeholder="按事件筛选 (如 login)" value={kind} onChange={e => setKind(e.target.value)} />
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

const FIELDS: { key: string; label: string; hint: string; type: 'num' | 'bool' | 'text' | 'list'; needs?: string }[] = [
  { key: 'siteName', label: '站点名称', hint: '显示在后台标题', type: 'text' },
  { key: 'sessionHours', label: '后台登录有效期(小时)', hint: '1–720', type: 'num' },
  { key: 'heartbeatMs', label: '心跳间隔(ms)', hint: '服务端 ping 周期,5000–120000', type: 'num' },
  { key: 'heartbeatDisconnectMs', label: '心跳断线阈值(ms)', hint: '超过该时间无 pong 则断开,需 ≥ 2×心跳', type: 'num' },
  { key: 'helloTimeoutMs', label: 'Hello 握手超时(ms)', hint: '连接后必须在此时间内认证', type: 'num' },
  { key: 'maxFramesPerSec', label: '单连接每秒帧数上限', hint: '超限返回 RATE_LIMITED', type: 'num' },
  { key: 'maxConnections', label: 'WebSocket 并发上限', hint: '8–1024', type: 'num' },
  { key: 'maxDevicesPerAccount', label: '每账号设备上限', hint: '1–4096', type: 'num' },
  { key: 'turnEnabled', label: '启用 TURN', hint: '关闭后不下发 TURN 凭据,只走 P2P / Relay;自定义 STUN 仍会下发', type: 'bool' },
  { key: 'turnTtlSeconds', label: 'TURN 凭据有效期(秒)', hint: '60–3600', type: 'num' },
  { key: 'stunEnabled', label: '启用 STUN', hint: '总开关。关闭后不下发任何 STUN(包括 TURN 凭据自带的),只剩 TURN / Relay', type: 'bool' },
  { key: 'stunUrls', label: '自定义 STUN', hint: '每行一个 stun:/stuns: 地址,最多 16 条;开启总开关时下发,排在最前面', type: 'list' },
  { key: 'stunUsePublicList', label: '启用公共列表 STUN', hint: '附加内置公共 STUN(国内 + 国际,含 443/19302 端口),共 10 条', type: 'bool', needs: 'stunEnabled' },
  { key: 'stunUseCloudflare', label: '启用 Cloudflare STUN', hint: '附加 stun.cloudflare.com 的 3478 / 443;需先填写自定义 STUN 才能开启', type: 'bool', needs: 'stunEnabled' },
  { key: 'allowedOrigins', label: '额外允许的 Origin', hint: '每行一个,如 https://dsh.example.com;自定义域名 Origin 与访问域名相同时无需填写', type: 'list' },
]

export function SettingsPage() {
  const [d, reload] = useData<any>('/api/v1/admin/settings')
  const toast = useToast()
  const [s, setS] = useState<any>(null)
  useEffect(() => { if (d) setS(d.settings) }, [d])
  if (!s) return null
  const val = (k: string, t: string) => t === 'list' ? (s[k] ?? []).join('\n') : s[k]
  const onChange = (k: string, t: string, v: any) => setS({ ...s, [k]: t === 'num' ? Number(v) : t === 'list' ? String(v).split('\n') : v })
  const locked = (f: { key: string; needs?: string }) => Boolean(f.needs && !s[f.needs])
  const effective: string[] = d?.effectiveStun ?? []
  const publicStun: string[] = d?.publicStun ?? []
  const save = async (body: any) => { try { await api('/api/v1/admin/settings', { method: 'PUT', body }); toast('s', '设置已生效'); reload() } catch (e: any) { toast('e', e.message) } }
  return (<>
    <Head title="系统设置" sub="默认值来自 wrangler.jsonc 的 vars(DSH_*);此处保存的值优先,实时生效(心跳间隔对新连接生效)">
      <button className="btn" onClick={() => save(d.defaults)}>恢复环境变量默认值</button><button className="btn pri" onClick={() => save(s)}><Save size={15} />保存</button></Head>
    <div className="card"><div className="form2">
      {FIELDS.map(f => <div className="field" key={f.key}><label>{f.label}{locked(f) && <span className="badge warn" style={{ marginLeft: 8 }}><i />未启用</span>}</label>
        {f.type === 'bool' ? <button className={`toggle ${s[f.key] && !locked(f) ? 'on' : ''}`} disabled={locked(f)} onClick={() => onChange(f.key, 'bool', !s[f.key])} />
          : f.type === 'list' ? <textarea rows={4} value={val(f.key, f.type)} disabled={!s.stunEnabled} onChange={e => onChange(f.key, f.type, e.target.value)} />
          : <input type={f.type === 'num' ? 'number' : 'text'} value={val(f.key, f.type)} onChange={e => onChange(f.key, f.type, e.target.value)} />}
        <p className="hint">{f.hint}{f.key === 'stunUseCloudflare' && !s.stunUrls?.filter(Boolean).length ? ';当前未填写自定义 STUN,该开关会被强制关闭' : ''}</p></div>)}
    </div></div>
    <div className="card"><h3><Cloud size={15} />当前实际下发的 STUN({effective.length} 条)</h3>
      {effective.length ? <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{effective.join('\n')}</pre>
        : <p className="hint">STUN 总开关已关闭,客户端只会拿到 TURN / Relay。</p>}
      <p className="hint" style={{ marginTop: 10 }}>公共列表({publicStun.length} 条,打开「启用公共列表 STUN」后追加):</p>
      <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', opacity: .8 }}>{publicStun.join('\n')}</pre></div>
  </>)
}
