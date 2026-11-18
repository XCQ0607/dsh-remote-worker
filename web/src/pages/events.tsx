import { useMemo, useState } from 'react'
import { Download, Search, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { useToast } from '../lib/toast'
import { useData } from '../lib/useData'
import { Bdg, Confirm, CopyBtn, Empty, Head, RefreshBtn, Skeleton, type ConfirmState } from '../components/kit'

const PAGE = 50
const EV_LABEL: Record<string, string> = {
  login: '账号登录',
  'oauth.register': 'OAuth 注册',
  'oauth.upsert': '配置 OAuth 提供方',
  'oauth.update': '更新 OAuth 开关',
  'oauth.delete': '删除 OAuth 提供方',
  'account.upsert': '新增 / 重置账号',
  'account.password': '修改密码',
  'account.password.changed': '修改密码',
  'account.admin': '变更管理员身份',
  'account.perms': '配置管理员权限',
  'account.meta': '更新账号配额/状态',
  'account.delete': '删除账号',
  'device.disconnect': '踢下线设备',
  'device.revoke': '吊销设备',
  'invite.create': '生成邀请码',
  'invite.delete': '删除邀请码',
  'invite.batch_delete': '批量清理邀请码',
  'link.drop': '断开实时连接',
  'settings.update': '更新系统设置',
  'turn.manual': '手动配置 TURN',
  'turn.provision': '创建 TURN 凭据',
  'turn.clear': '清除 TURN 配置',
  'pairing.complete': '扫码配对完成',
}
const PERM_LABEL: Record<string, string> = {
  overview: '概览', devices: '全部设备', accounts: '账号管理', links: '实时连接',
  turn: 'TURN 中转', settings: '系统设置', oauth: 'OAuth 登录', invites: '邀请码', events: '审计日志',
}
const evName = (t: string) => EV_LABEL[t] ?? t
const kindOf = (t: string): 'ok' | 'bad' | 'warn' | '' => /fail|error|revoke|delete|deny|reject|drop|clear/i.test(t) ? 'bad' : /login|create|upsert|ok|pair|provision/i.test(t) ? 'ok' : /update|settings|admin|perms|meta|password/i.test(t) ? 'warn' : ''
const fmtActor = (a?: string) => a === 'device-pairing' ? '扫码配对' : (a || '')
const fmtDetail = (t: string, d?: string): string => {
  if (!d) return ''
  if (t === 'login') {
    const m = /^oauth:(\S+)\s+(.+)$/.exec(d)
    return m ? `第三方登录 (${m[1]}) · IP ${m[2]}` : `密码登录 · IP ${d}`
  }
  if (t === 'account.admin') return d.replace(' -> true', ' → 设为管理员').replace(' -> false', ' → 取消管理员')
  if (t === 'account.perms') {
    const [em, ps] = d.split(' -> ')
    if (!ps || ps === 'none') return `${em} → 清空权限`
    return `${em} → ${ps.split(',').map(x => PERM_LABEL[x] ?? x).join('、')}`
  }
  if (t === 'invite.create' && d.startsWith('batch:')) return `批量生成 ${d.slice(6)} 个`
  if (t === 'invite.batch_delete') return `共清理 ${d} 个`
  if (t === 'oauth.register') return d.replace(/\sinvite:(\S+)/, ' · 邀请码 $1')
  return d
}

export function Events() {
  const [d, reload] = useData<any>('/api/v1/admin/events', 10000)
  const [q, setQ] = useState(''), [type, setType] = useState(''), [n, setN] = useState(PAGE)
  const [cfm, setCfm] = useState<ConfirmState>(null)
  const toast = useToast()
  const all: any[] = d?.items ?? []
  const types = useMemo(() => { const m = new Map<string, number>(); all.forEach(e => m.set(e.type, (m.get(e.type) ?? 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1]) }, [all])
  const items = useMemo(() => {
    const k = q.toLowerCase()
    return all.filter(e => (!type || e.type === type) && (!k || `${e.type} ${evName(e.type)} ${e.detail ?? ''} ${fmtDetail(e.type, e.detail)} ${e.actor ?? ''}`.toLowerCase().includes(k)))
  }, [all, q, type])
  const clear = () => setCfm({ title: '清空审计日志', body: '确定清空全部审计日志吗？此操作不可撤销。', okText: '确认清空', onOk: async () => { try { await api('/api/v1/admin/events', { method: 'DELETE' }); toast('s', '已清空'); reload() } catch (e: any) { toast('e', e.message) } } })
  const exportLogs = (fmt: 'json' | 'csv') => {
    const content = fmt === 'json'
      ? JSON.stringify(items.map(e => ({ ...e, label: evName(e.type), detailText: fmtDetail(e.type, e.detail) })), null, 2)
      : ['时间,事件,类型编码,详情,操作人', ...items.map((e: any) => [new Date(e.t).toLocaleString(), evName(e.type), e.type, fmtDetail(e.type, e.detail), fmtActor(e.actor)].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([content], { type: fmt === 'json' ? 'application/json' : 'text/csv' }))
    a.download = `dsh-audit-${Date.now()}.${fmt}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  return (<>
    <Head title="审计日志" sub={`最近 200 条登录与管理操作 · 共 ${all.length} 条，匹配 ${items.length} 条`}>
      <button className="btn" onClick={() => exportLogs('json')}><Download size={15} />JSON</button>
      <button className="btn" onClick={() => exportLogs('csv')}><Download size={15} />CSV</button>
      <RefreshBtn onClick={reload} auto="10 秒自动刷新" />
      <button className="btn danger" onClick={clear}><Trash2 size={15} />清空</button>
    </Head>
    {!d ? <Skeleton n={6} /> : <>
      <div className="pg-bar">
        <div className="search-box"><Search size={14} /><input placeholder="搜索事件 / 详情 / 账号" value={q} onChange={e => { setQ(e.target.value); setN(PAGE) }} /></div>
      </div>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={`chip ${!type ? 'on' : ''}`} onClick={() => { setType(''); setN(PAGE) }}>全部 {all.length}</button>
        {types.map(([t, c]) => <button key={t} className={`chip ${type === t ? 'on' : ''}`} onClick={() => { setType(t); setN(PAGE) }}>{evName(t)} {c}</button>)}
      </div>
      <div className="pg-list">
        {items.slice(0, n).map((e, i) => {
          const detail = fmtDetail(e.type, e.detail)
          const actor = fmtActor(e.actor)
          return (<div key={i} className="pg-item">
            <div className="main"><div className="t"><Bdg kind={kindOf(e.type)}>{evName(e.type)}</Bdg>{actor && <span className="pg-ev">{actor}<CopyBtn text={e.actor} what="账号" /></span>}</div>
              {detail && <div className="m pg-ev">{detail}<CopyBtn text={e.detail} what="详情" /></div>}</div>
            <span className="pg-ev" style={{ color: 'var(--mut)' }} title={new Date(e.t).toLocaleString()}>{new Date(e.t).toLocaleString()}</span>
          </div>)
        })}
        {!items.length && <Empty>{all.length ? '没有匹配的记录' : '暂无记录'}</Empty>}
      </div>
      {items.length > n && <div className="pg-more"><button className="btn" onClick={() => setN(n + PAGE)}>加载更多（剩余 {items.length - n}）</button></div>}
    </>}
    <Confirm state={cfm} onClose={() => setCfm(null)} />
  </>)
}
