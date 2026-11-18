import { useMemo, useState } from 'react'
import { KeyRound, Plus, Save, Search, Shield, ShieldCheck, ShieldOff, SlidersHorizontal, Trash2, Users as UsersIcon } from 'lucide-react'
import { api } from '../lib/api'
import { useToast } from '../lib/toast'
import { useData } from '../lib/useData'
import { Modal } from '../components/ui'
import { Bdg, CopyBtn, Empty, Head, RefreshBtn, Skeleton, StatCard } from '../components/kit'

const PERMS: { id: string; label: string; desc: string }[] = [
  { id: 'overview', label: '概览', desc: '查看运行指标与在线统计' },
  { id: 'devices', label: '全部设备', desc: '跨账号查看、踢下线与吊销设备' },
  { id: 'accounts', label: '账号管理', desc: '创建账号、改密、配额与封禁普通用户' },
  { id: 'links', label: '实时连接', desc: '查看与断开活动连接' },
  { id: 'turn', label: 'TURN 中转', desc: '配置与测试 Cloudflare TURN' },
  { id: 'settings', label: '系统设置', desc: '修改全局心跳、STUN 与限额' },
  { id: 'oauth', label: 'OAuth 登录', desc: '管理第三方登录与扫码配对' },
  { id: 'invites', label: '邀请码', desc: '生成、导出与清理邀请码' },
  { id: 'events', label: '审计日志', desc: '查看与清理系统审计记录' },
]

export function Accounts() {
  const [d, reload] = useData<any>('/api/v1/admin/accounts', 8000)
  const toast = useToast()
  const [email, setEmail] = useState(''), [password, setPassword] = useState('')
  const [pwModal, setPwModal] = useState<{ email: string; pw: string } | null>(null)
  const [metaModal, setMetaModal] = useState<{ email: string; disabled: boolean; maxDevices: string; def: number } | null>(null)
  const [permModal, setPermModal] = useState<{ email: string; perms: string[] } | null>(null)
  const [delModal, setDelModal] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState(''), [role, setRole] = useState<'all' | 'admin' | 'user'>('all'), [sort, setSort] = useState<'email' | 'devices' | 'online'>('email')
  const [sel, setSel] = useState<Set<string>>(new Set()), [showAdd, setShowAdd] = useState(false)
  const all: any[] = d?.items ?? []
  const isRootViewer = !!d?.viewerRootAdmin
  const list = useMemo(() => all.filter(a => (role === 'all' || (role === 'admin') === !!a.admin) && (!q || a.email.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => sort === 'email' ? a.email.localeCompare(b.email) : b[sort] - a[sort]), [all, q, role, sort])
  const save = async () => {
    setBusy(true)
    try { await api('/api/v1/admin/accounts', { body: { email, password } }); toast('s', '账号与密码已保存'); setEmail(''); setPassword(''); setShowAdd(false); reload() } catch (e: any) { toast('e', e.message) } finally { setBusy(false) }
  }
  const submitResetPw = async () => {
    if (!pwModal) return
    if (pwModal.pw.length < 12) { toast('e', '密码至少 12 位'); return }
    setBusy(true)
    try { await api('/api/v1/admin/accounts', { body: { email: pwModal.email, password: pwModal.pw } }); toast('s', `${pwModal.email} 密码已重置`); setPwModal(null); reload() } catch (x: any) { toast('e', x.message) } finally { setBusy(false) }
  }
  const saveMeta = async () => {
    if (!metaModal) return
    const n = metaModal.maxDevices.trim() ? Math.max(0, Math.min(4096, Number(metaModal.maxDevices) || 0)) : null
    setBusy(true)
    try {
      await api(`/api/v1/admin/accounts/${encodeURIComponent(metaModal.email)}/meta`, { body: { disabled: metaModal.disabled, maxDevices: n } })
      toast('s', '配额与状态已更新'); setMetaModal(null); reload()
    } catch (x: any) { toast('e', x.message) } finally { setBusy(false) }
  }
  const savePerms = async () => {
    if (!permModal) return
    setBusy(true)
    try {
      await api(`/api/v1/admin/accounts/${encodeURIComponent(permModal.email)}/perms`, { body: { perms: permModal.perms } })
      toast('s', `已更新 ${permModal.email} 的管理权限`); setPermModal(null); reload()
    } catch (x: any) { toast('e', x.message) } finally { setBusy(false) }
  }
  const toggleAdmin = async (e: string, next: boolean) => {
    if (busy) return
    setBusy(true)
    try { await api(`/api/v1/admin/accounts/${encodeURIComponent(e)}/admin`, { body: { admin: next } }); toast('s', next ? `已将 ${e} 设为管理员` : `已取消 ${e} 的管理员权限`); reload() } catch (x: any) { toast('e', x.message) } finally { setBusy(false) }
  }
  const delMany = async (es: string[]) => {
    setBusy(true)
    try {
      const rs = await Promise.allSettled(es.map(e => api(`/api/v1/admin/accounts/${encodeURIComponent(e)}`, { method: 'DELETE' })))
      const bad = rs.filter(r => r.status === 'rejected').length
      toast(bad ? 'e' : 's', bad ? `${bad} 个失败` : '已删除'); setDelModal(null); setSel(new Set()); reload()
    } finally { setBusy(false) }
  }
  const bulkAdmin = async (next: boolean) => {
    if (!ids.length || busy) return
    setBusy(true)
    try {
      const rs = await Promise.allSettled(ids.map(e => api(`/api/v1/admin/accounts/${encodeURIComponent(e)}/admin`, { body: { admin: next } })))
      const bad = rs.filter(r => r.status === 'rejected').length
      toast(bad ? 'e' : 's', bad ? `${bad} 个更新失败` : `已更新 ${ids.length} 个账号`); setSel(new Set()); reload()
    } finally { setBusy(false) }
  }
  const tog = (e: string) => setSel(s => { const n = new Set(s); n.has(e) ? n.delete(e) : n.add(e); return n })
  const canTouch = (a: any) => !a.rootAdmin && (!a.admin || isRootViewer)
  const ids = [...sel].filter(e => all.some(a => a.email === e && canTouch(a)))
  const selectable = list.filter(canTouch)
  const visPicked = selectable.filter(a => sel.has(a.email))
  const allSel = selectable.length > 0 && visPicked.length === selectable.length
  const partSel = visPicked.length > 0 && !allSel
  return (<>
    <Head title="账号管理" sub="多账号隔离：新增账号、配额封禁、重置密码、分配管理员与模块权限">
      <button className="btn pri" onClick={() => setShowAdd(true)}><Plus size={15} />新增账号</button>
      <RefreshBtn onClick={reload} auto="8 秒自动刷新" />
    </Head>
    {!d ? <Skeleton /> : <>
      <div className="pg-stats">
        <StatCard icon={<UsersIcon size={18} />} label="账号" value={all.length} />
        <StatCard icon={<ShieldCheck size={18} />} label="管理员" value={all.filter(a => a.admin).length} />
        <StatCard icon={<KeyRound size={18} />} label="在线设备" value={all.reduce((n, a) => n + a.online, 0)} />
      </div>
      <div className="pg-bar">
        <div className="search-box"><Search size={14} /><input placeholder="搜索账号邮箱" value={q} onChange={e => setQ(e.target.value)} /></div>
        <div className="seg">{(['all', 'admin', 'user'] as const).map(k => <button key={k} className={`chip ${role === k ? 'on' : ''}`} onClick={() => setRole(k)}>{k === 'all' ? '全部' : k === 'admin' ? '管理员' : '普通用户'}</button>)}</div>
        <select value={sort} onChange={e => setSort(e.target.value as any)}><option value="email">按邮箱</option><option value="devices">设备最多</option><option value="online">在线最多</option></select>
        {selectable.length > 0 && <label><input type="checkbox" ref={el => { if (el) el.indeterminate = partSel }} checked={allSel} onChange={e => setSel(e.target.checked ? new Set(selectable.map(a => a.email)) : new Set())} /><span>全选</span></label>}
      </div>
      <div className="pg-list">
        {list.map(a => {
          const pCnt = (a.adminPerms ?? []).length
          return (
          <div key={a.email} className={`pg-item ${sel.has(a.email) ? 'sel' : ''}`}>
            {canTouch(a) ? <input type="checkbox" checked={sel.has(a.email)} onChange={() => tog(a.email)} /> : <span style={{ width: 20 }} />}
            <div className="main"><div className="t">{a.email}<CopyBtn text={a.email} what="账号" />
              {a.rootAdmin ? <Bdg kind="warn">根管理员</Bdg> : a.admin ? <Bdg kind="ok">管理员 · {pCnt >= PERMS.length ? '全部权限' : `${pCnt}/${PERMS.length} 项`}</Bdg> : a.deviceOnly ? <Bdg>纯设备账号</Bdg> : <Bdg>普通用户</Bdg>}
              {a.disabled && <Bdg kind="bad">已禁用</Bdg>}</div>
              <div className="m"><span>设备 {a.devices}/{a.maxDevices ?? a.defaultMaxDevices ?? '-'}</span><span>在线 {a.online}</span></div></div>
            <div className="acts">
              {!a.deviceOnly && (!a.admin || isRootViewer) && <button className="btn sm" onClick={() => setPwModal({ email: a.email, pw: '' })}><KeyRound size={13} />改密</button>}
              {canTouch(a) && <button className="btn sm" onClick={() => setMetaModal({ email: a.email, disabled: !!a.disabled, maxDevices: a.maxDevices ? String(a.maxDevices) : '', def: a.defaultMaxDevices ?? 256 })}><SlidersHorizontal size={13} />配额</button>}
              {isRootViewer && !a.rootAdmin && a.admin && <button className="btn sm" onClick={() => setPermModal({ email: a.email, perms: a.adminPerms ?? PERMS.map(x => x.id) })}><Shield size={13} />权限</button>}
              {isRootViewer && !a.rootAdmin && <button className="btn sm" disabled={busy} onClick={() => toggleAdmin(a.email, !a.admin)}>{a.admin ? <ShieldOff size={13} /> : <ShieldCheck size={13} />}{a.admin ? '取消管理' : '设为管理'}</button>}
              {canTouch(a) && <button className="btn sm danger" onClick={() => setDelModal([a.email])}><Trash2 size={13} />删除</button>}
            </div></div>
          )
        })}
        {!list.length && <Empty>{all.length ? '没有匹配的账号' : '暂无账号'}</Empty>}
      </div>
      {ids.length > 0 && <div className="pg-bulk"><b>已选 {ids.length} 个</b><span className="sp" />
        {isRootViewer && <><button className="btn sm" disabled={busy} onClick={() => bulkAdmin(true)}>设为管理</button><button className="btn sm" disabled={busy} onClick={() => bulkAdmin(false)}>取消管理</button></>}
        <button className="btn sm danger" onClick={() => setDelModal(ids)}><Trash2 size={13} />批量删除</button>
        <button className="btn sm" onClick={() => setSel(new Set())}>取消</button></div>}
    </>}
    {showAdd && <Modal title="新增账号 / 重置密码" onClose={() => setShowAdd(false)}>
      <div className="field"><label>邮箱</label><input autoFocus value={email} onChange={e => setEmail(e.target.value)} /></div>
      <div className="field"><label>密码(≥12 位)</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && email && password.length >= 12 && save()} /></div>
      <div className="row right"><button className="btn" onClick={() => setShowAdd(false)}>取消</button><button className="btn pri" disabled={busy || !email || password.length < 12} onClick={save}><Save size={15} />{busy ? '保存中…' : '保存'}</button></div>
    </Modal>}
    {pwModal && <Modal title={`重置密码 · ${pwModal.email}`} onClose={() => setPwModal(null)}>
      <div className="field"><label>新密码（至少 12 位）</label><input type="password" autoFocus value={pwModal.pw} onChange={e => setPwModal({ ...pwModal, pw: e.target.value })} onKeyDown={e => e.key === 'Enter' && submitResetPw()} /></div>
      <div className="row right"><button className="btn" onClick={() => setPwModal(null)}>取消</button><button className="btn pri" disabled={busy || pwModal.pw.length < 12} onClick={submitResetPw}>{busy ? '提交中…' : '确认重置'}</button></div>
    </Modal>}
    {metaModal && <Modal title={`账号配额与状态 · ${metaModal.email}`} onClose={() => setMetaModal(null)}>
      <div className="field"><label>设备数量上限（留空或 0 使用全局默认 {metaModal.def} 台）</label>
        <input type="number" min={0} max={4096} value={metaModal.maxDevices} onChange={e => setMetaModal({ ...metaModal, maxDevices: e.target.value })} placeholder={`默认 ${metaModal.def}`} /></div>
      <div className="field"><label>封禁账号（禁用后将踢下线所有设备并禁止登录）</label>
        <button type="button" className={`toggle ${metaModal.disabled ? 'on' : ''}`} onClick={() => setMetaModal({ ...metaModal, disabled: !metaModal.disabled })} /></div>
      <div className="row right"><button className="btn" onClick={() => setMetaModal(null)}>取消</button><button className="btn pri" disabled={busy} onClick={saveMeta}><Save size={15} />{busy ? '保存中…' : '保存'}</button></div>
    </Modal>}
    {permModal && <Modal title={`管理员可见模块与权限 · ${permModal.email}`} onClose={() => setPermModal(null)}>
      <div className="row" style={{ marginBottom: 12 }}>
        <button type="button" className="btn sm" onClick={() => setPermModal({ ...permModal, perms: PERMS.map(x => x.id) })}>全选</button>
        <button type="button" className="btn sm" onClick={() => setPermModal({ ...permModal, perms: ['overview', 'devices', 'links', 'events'] })}>运维监控预设</button>
        <button type="button" className="btn sm" onClick={() => setPermModal({ ...permModal, perms: ['accounts', 'invites'] })}>用户与邀请预设</button>
        <button type="button" className="btn sm" onClick={() => setPermModal({ ...permModal, perms: [] })}>清空</button>
      </div>
      <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
        {PERMS.map(p => {
          const on = permModal.perms.includes(p.id)
          return (
            <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: `1px solid ${on ? 'var(--pri)' : 'var(--line)'}`, borderRadius: 10, background: 'var(--panel2)', margin: 0 }}>
              <input type="checkbox" checked={on} onChange={() => setPermModal({ ...permModal, perms: on ? permModal.perms.filter(x => x !== p.id) : [...permModal.perms, p.id] })} />
              <div style={{ minWidth: 0 }}><div style={{ fontWeight: 600 }}>{p.label}</div><div className="hint" style={{ margin: 0 }}>{p.desc}</div></div>
            </label>
          )
        })}
      </div>
      <div className="row right"><button className="btn" onClick={() => setPermModal(null)}>取消</button><button className="btn pri" disabled={busy} onClick={savePerms}><Save size={15} />{busy ? '保存中…' : '保存权限'}</button></div>
    </Modal>}
    {delModal && <Modal title="确认删除账号" onClose={() => setDelModal(null)}>
      <p style={{ marginTop: 0 }}>确定删除 {delModal.length === 1 ? `账号 ${delModal[0]}` : `选中的 ${delModal.length} 个账号`} 及其全部设备吗？此操作不可撤销。</p>
      <div className="row right"><button className="btn" onClick={() => setDelModal(null)}>取消</button><button className="btn danger" disabled={busy} onClick={() => delMany(delModal)}>{busy ? '删除中…' : '确认删除'}</button></div>
    </Modal>}
  </>)
}
