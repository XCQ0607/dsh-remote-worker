import { useEffect, useState, type ReactNode } from 'react'
import { Copy, Pencil, Plus, QrCode, RefreshCw, Save, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { useToast } from '../lib/toast'
import { ProviderIcon, Select } from '../components/ui'
import { useData } from '../lib/useData'
import { Confirm, useCopy, type ConfirmState } from '../components/kit'
import './invites.css'

const Head = ({ title, sub, children }: { title: string; sub: string; children?: ReactNode }) => (
  <div className="iv-head"><div><h1>{title}</h1><p>{sub}</p></div>{children && <div className="iv-acts">{children}</div>}</div>
)

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
  const copy = useCopy()
  const empty = { preset: 'github', id: 'github', displayName: 'GitHub', clientId: '', clientSecret: '', authUrl: '', tokenUrl: '', userInfoUrl: '', scopes: '', editing: false }
  const [f, setF] = useState(empty)
  const [cfm, setCfm] = useState<ConfirmState>(null)
  const [busy, setBusy] = useState(false)
  const onPreset = (v: string) => setF({
    ...f, preset: v, editing: false,
    id: v === 'custom' ? '' : v,
    displayName: OAUTH_PRESETS.find(x => x.value === v && v !== 'custom')?.label ?? '',
  })
  const set = async (id: string, body: object) => {
    if (busy) return
    setBusy(true)
    try { await api(`/api/v1/admin/oauth/${id}`, { body }); reload() } catch (e: any) { toast('e', e.message) } finally { setBusy(false) }
  }
  const add = async () => {
    if (!f.id.trim()) return toast('e', '请填写标识 ID')
    if (f.clientId.trim().length < 4) return toast('e', 'Client ID 至少需要 4 个字符')
    if (!f.editing && f.clientSecret.trim().length < 4) return toast('e', 'Client Secret 至少需要 4 个字符')
    setBusy(true)
    try {
      await api('/api/v1/admin/oauth', {
        body: {
          id: f.id, displayName: f.displayName || f.id, clientId: f.clientId,
          ...(f.clientSecret ? { clientSecret: f.clientSecret } : {}),
          ...(f.preset === 'custom' ? { authUrl: f.authUrl, tokenUrl: f.tokenUrl, userInfoUrl: f.userInfoUrl, ...(f.scopes ? { scopes: f.scopes } : {}) } : {}),
        },
      })
      toast('s', `已保存 ${f.displayName || f.id}`); setF(empty); reload()
    } catch (e: any) { toast('e', e.message) } finally { setBusy(false) }
  }
  const editRow = (p: any) => {
    const isPreset = OAUTH_PRESETS.some(x => x.value === p.id && x.value !== 'custom')
    setF({ preset: isPreset ? p.id : 'custom', id: p.id, displayName: p.displayName, clientId: p.clientId || '', clientSecret: '', authUrl: p.authUrl || '', tokenUrl: p.tokenUrl || '', userInfoUrl: p.userInfoUrl || '', scopes: p.scopes || '', editing: true })
    scrollTo({ top: 0, behavior: 'smooth' })
  }
  const del = (id: string) => setCfm({
    title: '删除 OAuth 提供方', body: `确定删除后台配置的 ${id} 吗？`, okText: '确认删除',
    onOk: async () => { try { await api(`/api/v1/admin/oauth/${id}`, { method: 'DELETE' }); toast('s', '已删除'); reload() } catch (e: any) { toast('e', e.message) } },
  })
  return (<>
    <Head title="OAuth 登录" sub="支持在后台直接新增/编辑/管理第三方登录（持久化在 DO 存储，重新部署不丢），也可通过 provider.json 预设。回调地址需填到对应平台应用中。">
      <button className="btn" onClick={reload}><RefreshCw size={15} />刷新</button>
    </Head>
    {d?.devicePairing && <DevicePairingCard info={d.devicePairing} onUpdated={reload} />}
    <div className="iv-form">
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
      <button className="btn pri" disabled={busy || !f.id || !f.clientId || (!f.editing && !f.clientSecret) || (f.preset === 'custom' && (!f.authUrl || !f.tokenUrl || !f.userInfoUrl))} onClick={add}><Save size={15} />{busy ? '保存中…' : '保存'}</button>
    </div>
    {!d ? <div className="iv-list">{[1, 2].map(i => <div key={i} className="iv-skel" />)}</div> : !d.items.length ? <div className="iv-empty">尚未配置任何 OAuth 提供方，可在上方直接添加</div> :
    <div className="iv-list">{d.items.map((p: any) => (
      <div className="iv-item" key={p.id}>
        <div className="main">
          <div className="t"><ProviderIcon id={p.id} size={16} />{p.displayName}<span className="mono" style={{ opacity: .6, fontWeight: 400 }}>{p.id}</span>
            <span className={`badge ${p.enabled ? 'ok' : ''}`}><i />{p.enabled ? '已启用' : '已停用'}</span>
            <span className="badge">{p.source === 'dashboard' ? '后台配置' : '环境变量'}</span></div>
          <div className="m mono">{p.callbackUrl}</div>
          <div className="row" style={{ gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
            <label className="row" style={{ gap: 6, fontSize: 13 }}><button className={`toggle ${p.enabled ? 'on' : ''}`} onClick={() => set(p.id, { enabled: !p.enabled })} />启用登录</label>
            <label className="row" style={{ gap: 6, fontSize: 13 }}><button className={`toggle ${p.allowRegister ? 'on' : ''}`} onClick={() => set(p.id, { allowRegister: !p.allowRegister })} />允许注册</label>
            {p.allowRegister && <label className="row" style={{ gap: 6, fontSize: 13 }}><button className={`toggle ${(p.requireInviteCode ?? true) ? 'on' : ''}`} onClick={() => set(p.id, { requireInviteCode: !(p.requireInviteCode ?? true) })} />需邀请码</label>}
          </div>
        </div>
        <div className="r">
          <button className="icon-btn" title="复制回调地址" onClick={() => copy(p.callbackUrl, '回调地址')}><Copy size={14} /></button>
          <button className="btn sm" onClick={() => editRow(p)}><Pencil size={13} />编辑</button>
          {p.source === 'dashboard' && <button className="btn sm danger" onClick={() => del(p.id)}><Trash2 size={13} />删除</button>}
        </div>
      </div>))}</div>}
    <OAuthEmailRules />
    <Confirm state={cfm} onClose={() => setCfm(null)} />
  </>)
}

function DevicePairingCard({ info, onUpdated }: { info: { enabled: boolean; protocol: string; qrFormat: string; serverPublicKey: string; activeSessions: number }; onUpdated: () => void }) {
  const toast = useToast()
  const copy = useCopy()
  const [busy, setBusy] = useState(false)
  const toggle = async () => {
    setBusy(true)
    try {
      await api('/api/v1/admin/settings', { method: 'PUT', body: { devicePairingEnabled: !info.enabled } })
      toast('s', !info.enabled ? '已启用 DSH Go 扫码配对' : '已停用 DSH Go 扫码配对')
      onUpdated()
    } catch (e: any) { toast('e', e.message) } finally { setBusy(false) }
  }
  return (
    <div className="iv-item" style={{ marginBottom: 14 }}>
      <div className="main">
        <div className="t">
          <QrCode size={16} />DSH Go 扫码配对
          <span className="mono" style={{ opacity: .6, fontWeight: 400 }}>{info.protocol}</span>
          <span className={`badge ${info.enabled ? 'ok' : ''}`}><i />{info.enabled ? '已启用' : '已停用'}</span>
          <span className="badge">纯设备账号 (device_only)</span>
        </div>
        <div className="m" style={{ marginTop: 6 }}>
          电脑端插件无需登录账号即可生成二维码，供 DSH Go 手机端扫码配对（当前主机仅被控）。配对后自动创建 <code className="mono">dsh-device:&lt;UUID&gt;</code> 账号，可在「账号管理」和「全部设备」中管理。
        </div>
        <div className="m mono" style={{ marginTop: 6 }}>
          服务端公钥: {info.serverPublicKey} · 活跃会话: {info.activeSessions}
        </div>
        <div className="row" style={{ gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
          <label className="row" style={{ gap: 6, fontSize: 13 }}>
            <button className={`toggle ${info.enabled ? 'on' : ''}`} disabled={busy} onClick={toggle} />启用 DSH Go 扫码配对
          </label>
        </div>
      </div>
      <div className="r">
        <button className="icon-btn" title="复制服务端公钥" onClick={() => copy(info.serverPublicKey, '服务端公钥')}><Copy size={14} /></button>
      </div>
    </div>
  )
}

function OAuthEmailRules() {
  const [cfg, reload] = useData<any>('/api/v1/admin/settings')
  const [allow, setAllow] = useState('')
  const [block, setBlock] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  useEffect(() => {
    const s = cfg?.settings ?? cfg
    if (s) {
      setAllow((s.oauthAllowedDomains ?? []).join(', '))
      setBlock((s.oauthBlockedDomains ?? []).join(', '))
    }
  }, [cfg])
  const save = async () => {
    setBusy(true)
    try {
      await api('/api/v1/admin/settings', {
        method: 'PUT',
        body: { oauthAllowedDomains: allow, oauthBlockedDomains: block },
      })
      toast('s', '邮箱黑白名单已保存')
      reload()
    } catch (e: any) { toast('e', e.message) } finally { setBusy(false) }
  }
  return (
    <div className="card form-card" style={{ marginTop: 16 }}>
      <h3 style={{ margin: '0 0 10px' }}>OAuth 注册邮箱白名单 / 黑名单</h3>
      <div className="hint" style={{ marginBottom: 12 }}>支持填写完整邮箱或域名（如 <span className="mono">company.com, user@example.com</span>），逗号分隔；黑名单优先于白名单，白名单留空表示不限制。</div>
      <div className="form-grid">
        <label className="field"><span>邮箱 / 域名白名单</span><input value={allow} onChange={e => setAllow(e.target.value)} placeholder="留空不限制，例如 gmail.com, company.com" /></label>
        <label className="field"><span>邮箱 / 域名黑名单</span><input value={block} onChange={e => setBlock(e.target.value)} placeholder="例如 temp-mail.org, spam@test.com" /></label>
      </div>
      <div className="form-actions"><button className="btn pri" disabled={busy} onClick={save}><Save size={15} />{busy ? '保存中…' : '保存规则'}</button></div>
    </div>
  )
}

