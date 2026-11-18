import { useState } from 'react'
import { CheckCircle2, Cloud, Copy, Cpu, Plug, Users as UsersIcon } from 'lucide-react'
import { api, fmtDur } from '../lib/api'
import { useToast } from '../lib/toast'
import { useData } from '../lib/useData'
import { Bdg, Head, RefreshBtn, Skeleton, StatCard, useCopy } from '../components/kit'

export function Overview() {
  const [d, reload] = useData<any>('/api/v1/admin/overview', 5000)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const copy = useCopy()
  if (!d) return <><Head title="概览" /><Skeleton n={3} /></>
  const testTurn = async () => {
    if (busy) return
    setBusy(true)
    try { const r = await api<any>('/api/v1/admin/turn/test', { body: {} }); toast(r.turn ? 's' : 'e', r.turn ? `TURN 正常(${r.servers.length} 组地址)` : `TURN 未启用: ${r.error ?? '未配置'}`) } catch (e: any) { toast('e', e.message) } finally { setBusy(false) }
  }
  const c = d.config ?? {}
  const kv = (k: string, v: any) => <div className="pg-kv"><span>{k}</span><span>{v}</span></div>
  const onl = (v: boolean | undefined) => v === false ? '关' : '开'
  return (<>
    <Head title={d.siteName} sub={`已运行 ${fmtDur(d.uptimeMs)} · ${d.origin}`}>
      <button className="btn" onClick={() => copy(d.origin, '接入地址')}><Copy size={15} />复制地址</button>
      <RefreshBtn onClick={reload} auto="5 秒自动刷新" />
    </Head>
    <div className="pg-stats">
      <StatCard icon={<UsersIcon size={18} />} label="账号" value={d.accounts} />
      <StatCard icon={<Cpu size={18} />} label={`设备 · ${d.devices.hosts} Host / ${d.devices.clients} Client`} value={d.devices.total} />
      <StatCard icon={<Plug size={18} />} label={`在线设备 / ${d.devices.total}`} value={d.devices.online} />
      <StatCard icon={<Cloud size={18} />} label={`活动连接 · ${d.sockets} WS`} value={d.links} />
    </div>
    <div className="pg-grid2">
      <div className="card"><h3>TURN 中转</h3>
        <div className="row"><Bdg kind={d.turn.enabled ? 'ok' : d.turn.configured ? 'warn' : ''}>{d.turn.enabled ? '已启用' : d.turn.configured ? '已配置但被关闭' : '未配置(仅 Relay)'}</Bdg>
          <button className="btn sm right" disabled={busy} onClick={testTurn}><CheckCircle2 size={14} />{busy ? '测试中…' : '测试签发'}</button></div>
        <p className="hint">{d.turn.keyId ? `Key: ${d.turn.keyId}` : '前往「TURN 中转」页一键创建 Cloudflare TURN Key。'}</p></div>
      <div className="card"><h3>运行参数</h3>
        {kv('P2P', onl(c.p2pEnabled))}{kv('STUN', onl(c.stunEnabled))}{kv('心跳', `${Math.round((c.heartbeatMs ?? 25000) / 1000)}s`)}
        {kv('WS 上限', `${d.sockets} / ${c.maxConnections ?? 256}`)}{kv('TURN TTL', `${c.turnTtlSeconds ?? 300}s`)}
        <div className="bar"><div style={{ width: `${Math.min(100, d.sockets / (c.maxConnections || 256) * 100)}%` }} /></div></div>
      <div className="card"><h3>免费额度提示</h3>
        <p className="hint" style={{ fontSize: 13 }}>Workers 免费版每日 10 万请求、DO 13,000 GB-s，启用 Hibernation 空闲不计时。</p>
        <p className="hint" style={{ fontSize: 13 }}>当前管理员：{d.you}</p></div>
    </div>
  </>)
}