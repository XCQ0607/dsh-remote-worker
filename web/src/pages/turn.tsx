import { useState } from 'react'
import { CheckCircle2, Cloud, Copy, Eye, EyeOff, Save, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { useToast } from '../lib/toast'
import { useData } from '../lib/useData'
import { Confirm, useCopy, type ConfirmState } from '../components/kit'
import './turn.css'

const Pw = ({ v, on, ph }: { v: string; on: (v: string) => void; ph?: string }) => {
  const [show, setShow] = useState(false)
  return <div className="tn-pw"><input type="text" className={show ? '' : 'secret-mask'} value={v} placeholder={ph} autoComplete="off" data-lpignore="true" data-1p-ignore="true" spellCheck={false} autoCapitalize="none" onChange={e => on(e.target.value)} />
    <button type="button" className="icon-btn" onClick={() => setShow(!show)}>{show ? <EyeOff size={14} /> : <Eye size={14} />}</button></div>
}

export function Turn() {
  const [d, reload] = useData<any>('/api/v1/admin/turn', 30000)
  const toast = useToast()
  const copy = useCopy()
  const [mode, setMode] = useState<'token' | 'global'>('token')
  const [f, setF] = useState({ accountId: '', apiToken: '', email: '', apiKey: '', keyId: '', turnToken: '' })
  const [test, setTest] = useState<any>(null)
  const [busy, setBusy] = useState('')
  const [cfm, setCfm] = useState<ConfirmState>(null)
  const set = (k: string) => (v: string) => setF({ ...f, [k]: v.trim() })
  const auth = mode === 'token' ? { apiToken: f.apiToken } : { email: f.email, apiKey: f.apiKey }
  const run = async (id: string, fn: () => Promise<any>, ok: string) => { setBusy(id); try { await fn(); toast('s', ok); reload() } catch (e: any) { toast('e', e.message || e.code) } finally { setBusy('') } }
  const accOk = /^[0-9a-f]{32}$/i.test(f.accountId)
  const createOk = accOk && (mode === 'token' ? !!f.apiToken : !!f.email && !!f.apiKey)
  return (
    <div className="tn">
      <div className="page-head"><div className="page-head-text"><h1>TURN 中转</h1><p className="sub">使用 Cloudflare Realtime TURN(每月 1,000GB 免费),P2P 失败时低延迟中转</p></div></div>
      <div className="tn-grid">
        <div className="card"><h3>当前状态</h3>
          <div className="tn-row"><span className={`badge ${d?.configured ? 'ok' : ''}`}><i />{d ? (d.configured ? `已配置(${d.source === 'env' ? '环境变量' : '后台'})` : '未配置') : '加载中…'}</span></div>
          <div className="tn-kv"><span>Key ID</span><code>{d?.keyId ?? '-'}</code>{d?.keyId && <button className="icon-btn" onClick={() => copy(d.keyId, 'Key ID')}><Copy size={14} /></button>}</div>
          <div className="tn-row">
            <button className="btn" disabled={busy === 'test'} onClick={async () => { setBusy('test'); try { setTest(await api('/api/v1/admin/turn/test', { body: {} })) } catch (e: any) { toast('e', e.message) } finally { setBusy('') } }}><CheckCircle2 size={15} />{busy === 'test' ? '测试中…' : '测试签发凭据'}</button>
            {d?.source === 'dashboard' && <button className="btn danger" onClick={() => setCfm({ title: '清除 TURN 配置', body: '确定清除后台保存的 TURN 配置吗？', okText: '确认清除', onOk: () => run('clr', () => api('/api/v1/admin/turn', { method: 'DELETE' }), '已清除') })}><Trash2 size={15} />清除</button>}</div>
          {test && <div className={`tn-res ${test.turn ? 'ok' : 'bad'}`}>{test.turn ? `成功:返回 ${test.servers?.length ?? 0} 组服务器` : `失败:${test.error ?? '未配置 TURN'}`}</div>}
        </div>
        <div className="card"><h3>手动填入已有 Key</h3>
          <div className="field"><label>TURN Key ID</label><input autoComplete="off" data-lpignore="true" spellCheck={false} value={f.keyId} onChange={e => set('keyId')(e.target.value)} /></div>
          <div className="field"><label>TURN API Token</label><Pw v={f.turnToken} on={set('turnToken')} /></div>
          <button className="btn" disabled={!f.keyId || !f.turnToken || busy === 'man'} onClick={() => run('man', () => api('/api/v1/admin/turn/manual', { body: { keyId: f.keyId, apiToken: f.turnToken } }), '已保存')}><Save size={15} />保存</button></div>
      </div>
      <div className="card"><h3><Cloud size={15} />一键创建 TURN Key</h3>
        <p className="hint">凭据只用于本次调用 Cloudflare API,不会被保存。需要 Realtime/Calls 编辑权限。</p>
        <div className="tn-tabs"><button className={mode === 'token' ? 'on' : ''} onClick={() => setMode('token')}>API Token</button><button className={mode === 'global' ? 'on' : ''} onClick={() => setMode('global')}>Global API Key</button></div>
        <div className="tn-form">
          <div className="field"><label>Account ID</label><input autoComplete="off" data-lpignore="true" spellCheck={false} value={f.accountId} onChange={e => set('accountId')(e.target.value)} placeholder="32 位十六进制" />{f.accountId && !accOk && <p className="hint tn-err">需为 32 位十六进制</p>}</div>
          {mode === 'token' ? <div className="field"><label>API Token</label><Pw v={f.apiToken} on={set('apiToken')} /></div> : <>
            <div className="field"><label>邮箱</label><input type="email" value={f.email} onChange={e => set('email')(e.target.value)} /></div>
            <div className="field"><label>Global API Key</label><Pw v={f.apiKey} on={set('apiKey')} /></div></>}
        </div>
        <button className="btn pri" disabled={!createOk || busy === 'prov'} onClick={() => run('prov', () => api('/api/v1/admin/turn/provision', { body: { accountId: f.accountId, ...auth } }), 'TURN Key 已创建并启用')}>{busy === 'prov' ? '创建中…' : '创建并启用'}</button>
      </div>
      <Confirm state={cfm} onClose={() => setCfm(null)} />
    </div>)
}