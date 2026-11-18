import { useState } from 'react'
import { api } from '../lib/api'
import { useToast } from '../lib/toast'
import { useData } from '../lib/useData'
import { Modal } from './ui'
import { Confirm, type ConfirmState } from './kit'

const PLAT: Record<string, { name: string; color: string; hint: string }> = {
  feishu: { name: '飞书 / Lark', color: '#3370FF', hint: '可选：机器人签名密钥' },
  dingtalk: { name: '钉钉', color: '#0089FF', hint: '可选：加签密钥 (SEC...)' },
  wecom: { name: '企业微信', color: '#07C160', hint: '企业微信无需密钥' },
  discord: { name: 'Discord', color: '#5865F2', hint: 'Discord 无需密钥' },
  slack: { name: 'Slack', color: '#E01E5A', hint: 'Slack 无需密钥' },
  custom: { name: '通用 Webhook', color: '#8b8fa3', hint: '可选：用于 X-DSH-Signature (HMAC-SHA256)' },
}
function detect(url: string) {
  const u = url.toLowerCase()
  return u.includes('feishu.cn') || u.includes('larksuite.com') ? 'feishu' : u.includes('dingtalk.com') ? 'dingtalk' : u.includes('qyapi.weixin') ? 'wecom'
    : u.includes('discord') && u.includes('/webhooks') ? 'discord' : u.includes('hooks.slack.com') ? 'slack' : 'custom'
}
const EV: Record<string, string> = { host_offline: '主机离线', host_online: '主机上线恢复', device_registered: '新设备接入', test: '测试' }
const ago = (t?: number) => { if (!t) return '从未触发'; const s = Math.floor((Date.now() - t) / 1000); return s < 60 ? `${s} 秒前` : s < 3600 ? `${Math.floor(s / 60)} 分钟前` : s < 86400 ? `${Math.floor(s / 3600)} 小时前` : new Date(t).toLocaleDateString() }

function Dot({ id }: { id: string }) {
  const p = PLAT[id] ?? PLAT.custom
  return <span className="wh-ico" style={{ background: p.color }}>{p.name.slice(0, 1)}</span>
}

type Form = { id?: string; name: string; url: string; secret: string; events: string[]; devs: string; delay: string; hasSecret?: boolean; clearSecret?: boolean }
const blank: Form = { name: '', url: '', secret: '', events: ['host_offline', 'host_online', 'device_registered'], devs: '', delay: '0' }

export function WebhookPanel() {
  const [d, reload] = useData<any>('/api/v1/account/webhooks', 20000)
  const [f, setF] = useState<Form | null>(null)
  const [busy, setBusy] = useState('')
  const [showLog, setShowLog] = useState(false)
  const [cfm, setCfm] = useState<ConfirmState>(null)
  const toast = useToast()
  const items: any[] = d?.items ?? []
  const logs: any[] = d?.logs ?? []
  const names: Record<string, string> = Object.fromEntries(items.map(i => [i.id, i.name || PLAT[i.platform]?.name]))
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (!f) return
    if (!f.events.length) return toast('e', '至少选择一个触发事件')
    setBusy('save')
    try {
      const body: any = { id: f.id, name: f.name.trim(), events: f.events, deviceIds: f.devs.split(/[,\s]+/).filter(Boolean), offlineDelaySec: Math.max(0, Math.min(300, Number(f.delay) || 0)) }
      if (f.url.trim()) body.url = f.url.trim()
      if (f.clearSecret) body.secret = ''
      else if (f.secret || !f.id) body.secret = f.secret
      await api('/api/v1/account/webhooks', { method: 'POST', body })
      toast('s', f.id ? 'Webhook 已保存' : 'Webhook 已添加'); setF(null); reload()
    } catch (err: any) { toast('e', err.message) } finally { setBusy('') }
  }
  const patch = async (id: string, body: any) => {
    if (busy) return
    setBusy(id)
    try { await api('/api/v1/account/webhooks', { method: 'POST', body: { id, ...body } }); reload() } catch (err: any) { toast('e', err.message) } finally { setBusy('') }
  }
  const del = (it: any) => setCfm({
    title: '删除 Webhook', body: `确定删除 Webhook「${it.name || PLAT[it.platform].name}」吗？`, okText: '确认删除',
    onOk: async () => { try { await api(`/api/v1/account/webhooks/${encodeURIComponent(it.id)}`, { method: 'DELETE' }); toast('s', '已删除'); reload() } catch (err: any) { toast('e', err.message) } },
  })
  const test = async (id: string) => {
    setBusy(id)
    try { const r = await api('/api/v1/account/webhooks/test', { method: 'POST', body: { id } }); toast('s', `发送成功 · HTTP ${r.status} · ${r.ms}ms`) }
    catch (err: any) { toast('e', `测试失败：${err.message}`) } finally { setBusy(''); reload() }
  }
  const edit = (it: any) => setF({ id: it.id, name: it.name, url: it.url ?? '', secret: '', events: it.events, devs: (it.deviceIds ?? []).join(', '), delay: String(it.offlineDelaySec ?? 0), hasSecret: it.hasSecret })
  const plat = f ? detect(f.url) : 'custom'

  return <div className="card wh">
    <div className="wh-head">
      <div><h3 style={{ margin: 0 }}>Webhook 告警通知</h3><div className="hint">主机离线 / 新设备接入时推送到飞书、钉钉、企微、Discord、Slack 或自定义地址 · {items.length}/{d?.max ?? 10}</div></div>
      <div className="row">
        <button className="btn sm" onClick={() => setShowLog(v => !v)}>{showLog ? '收起日志' : `投递日志 (${logs.length})`}</button>
        <button className="btn pri sm" disabled={items.length >= (d?.max ?? 10)} onClick={() => setF({ ...blank })}>＋ 添加 Webhook</button>
      </div>
    </div>

    <div className="wh-list">
      {items.map(it => <div key={it.id} className={`wh-item ${it.enabled ? '' : 'off'}`}>
        <Dot id={it.platform} />
        <div className="wh-main">
          <div className="wh-title">{it.name || PLAT[it.platform].name}
            {it.lastAt && <span className={`badge ${it.lastOk ? 'ok' : 'bad'}`}><i />{it.lastOk ? '正常' : '失败'}</span>}
            {it.hasSecret && <span className="badge">已签名</span>}</div>
          <div className="mono wh-url">{it.urlMasked}</div>
          <div className="hint">{it.events.map((e: string) => EV[e]).join(' · ')}{it.offlineDelaySec ? ` · 离线防抖 ${it.offlineDelaySec}s` : ''}{it.deviceIds?.length ? ` · ${it.deviceIds.length} 台设备` : ' · 全部设备'} · 最近 {ago(it.lastAt)}{it.lastOk === false && it.lastError ? ` · ${it.lastError}` : ''} · 成功 {it.okCount ?? 0} / 失败 {it.failCount ?? 0}</div>
        </div>
        <div className="wh-act">
          <button type="button" disabled={busy === it.id} className={`toggle ${it.enabled ? 'on' : ''}`} aria-label="启用" onClick={() => patch(it.id, { enabled: !it.enabled })} />
          <button className="btn sm" disabled={busy === it.id} onClick={() => test(it.id)}>{busy === it.id ? '发送中…' : '测试'}</button>
          <button className="btn sm" onClick={() => edit(it)}>编辑</button>
          <button className="btn sm danger" onClick={() => del(it)}>删除</button>
        </div>
      </div>)}
      {d && !items.length && <div className="empty">还没有 Webhook，点击右上角「添加 Webhook」创建第一个告警通道</div>}
    </div>

    {showLog && <div className="wh-log">
      <div className="wh-head" style={{ marginBottom: 4 }}>
        <b>最近投递（最多 50 条）</b>
        {!!logs.length && <button className="btn sm danger" onClick={() => setCfm({ title: '清空投递日志', body: '确定清空全部 Webhook 投递日志吗？', okText: '确认清空', onOk: async () => { await api('/api/v1/account/webhooks-logs', { method: 'DELETE' }); toast('s', '已清空'); reload() } })}>清空日志</button>}
      </div>
      <div className="wh-log-body">
        {logs.map((l: any, i: number) => <div key={i} className="wh-logrow">
          <span className={`badge ${l.ok ? 'ok' : 'bad'}`}><i />{l.ok ? 'OK' : 'ERR'}</span>
          <span className="wh-log-ev">{EV[l.event] ?? l.event}</span>
          <span className="hint">{names[l.id] ?? l.id}</span>
          <span className="mono hint wh-log-msg">{l.status ? `HTTP ${l.status}` : '未连接'} · {l.ms}ms{l.error ? ` · ${l.error}` : ''}</span>
          <span className="hint wh-log-time">{new Date(l.t).toLocaleTimeString()}</span>
        </div>)}
        {!logs.length && <div className="empty">暂无投递记录</div>}
      </div>
    </div>}

    {f && <Modal title={`${f.id ? '编辑' : '新建'} Webhook · ${PLAT[plat].name}`} onClose={() => setF(null)}>
      <form className="wh-modal-form" onSubmit={save}>
        <div className="field"><label>名称（可选）</label><input value={f.name} maxLength={64} onChange={e => setF({ ...f, name: e.target.value })} placeholder="例如 运维告警群" /></div>
        <div className="field"><label>Webhook URL（仅支持 https）</label><input type="url" required={!f.id} value={f.url} onChange={e => setF({ ...f, url: e.target.value })} placeholder={f.id ? '留空保持原地址不变' : 'https://...'} /></div>
        <div className="field"><label>签名密钥{f.hasSecret ? '（已设置，留空不修改）' : ''}</label><input type="password" autoComplete="new-password" disabled={f.clearSecret} value={f.secret} onChange={e => setF({ ...f, secret: e.target.value })} placeholder={PLAT[plat].hint} />
          {f.hasSecret && <label style={{ marginTop: 6, fontSize: 12 }}><input type="checkbox" checked={!!f.clearSecret} onChange={e => setF({ ...f, clearSecret: e.target.checked, secret: '' })} /><span>清除已设置的密钥</span></label>}</div>
        <div className="field"><label>仅监控设备 ID（逗号分隔，留空监控全部）</label><input value={f.devs} onChange={e => setF({ ...f, devs: e.target.value })} placeholder="device-1, device-2" /></div>
        <div className="field"><label>离线防抖延迟（秒，0=立即，建议 15-60 避免重连误报）</label><input type="number" min={0} max={300} value={f.delay} onChange={e => setF({ ...f, delay: e.target.value })} /></div>
        <div className="field"><label>触发事件</label>
          <div className="wh-chips">{Object.entries(EV).filter(([k]) => k !== 'test').map(([k, v]) =>
            <button type="button" key={k} className={`chip ${f.events.includes(k) ? 'on' : ''}`} onClick={() => setF({ ...f, events: f.events.includes(k) ? f.events.filter(x => x !== k) : [...f.events, k] })}>{f.events.includes(k) ? '✓ ' : ''}{v}</button>)}</div>
        </div>
        <div className="row right"><button type="button" className="btn" onClick={() => setF(null)}>取消</button><button className="btn pri" disabled={busy === 'save'}>{busy === 'save' ? '保存中…' : '保存'}</button></div>
      </form>
    </Modal>}
    <Confirm state={cfm} onClose={() => setCfm(null)} />
  </div>
}
