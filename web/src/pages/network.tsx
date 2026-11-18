import { useRef, useState } from 'react'
import { Activity, CheckCircle2, Play, XCircle } from 'lucide-react'
import { api } from '../lib/api'
import './network.css'

type Stun = { url: string; state: 'idle' | 'run' | 'ok' | 'bad'; ms?: number; ip?: string }
const N = 10

function probe(url: string): Promise<{ ms: number; ip?: string } | null> {
  return new Promise(resolve => {
    const t0 = performance.now()
    const pc = new RTCPeerConnection({ iceServers: [{ urls: url }] })
    let done = false
    const fin = (r: { ms: number; ip?: string } | null) => { if (done) return; done = true; clearTimeout(to); pc.close(); resolve(r) }
    const to = setTimeout(() => fin(null), 4000)
    pc.createDataChannel('p')
    pc.onicecandidate = e => {
      const c = e.candidate?.candidate
      if (c && / typ srflx /.test(c)) fin({ ms: Math.round(performance.now() - t0), ip: c.split(' ')[4] })
    }
    pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => fin(null))
  })
}

function Chart({ pts }: { pts: number[] }) {
  if (!pts.length) return <div className="nw-empty">点击「开始诊断」采集延迟</div>
  const W = 400, H = 110, max = Math.max(...pts, 50) * 1.15
  const x = (i: number) => (pts.length < 2 ? W / 2 : (i / (N - 1)) * W)
  const y = (v: number) => H - (v / max) * H
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return <svg viewBox={`0 0 ${W} ${H}`} className="nw-chart" preserveAspectRatio="none">
    {[0.25, 0.5, 0.75].map(k => <line key={k} x1="0" x2={W} y1={H * k} y2={H * k} />)}
    <path d={`${d} L${x(pts.length - 1)},${H} L${x(0)},${H}Z`} className="fill" /><path d={d} className="ln" />
    {pts.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="3"><title>{v} ms</title></circle>)}</svg>
}

export function NetworkPage() {
  const [pts, setPts] = useState<number[]>([])
  const [fails, setFails] = useState(0)
  const [stuns, setStuns] = useState<Stun[]>([])
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [at, setAt] = useState<Date | null>(null)
  const run = useRef(0)
  const start = async () => {
    const id = ++run.current
    setBusy(true); setPts([]); setFails(0); setStuns([]); setInfo('')
    const samples: number[] = []; let urls: string[] = []; let bad = 0
    for (let i = 0; i < N; i++) {
      try {
        const t0 = performance.now()
        const r = await api<any>('/api/v1/network/ping')
        samples.push(Math.round(performance.now() - t0)); setPts([...samples])
        if (i === 0) urls = r.stunServers ?? []
      } catch { bad++; setFails(bad) }
    }
    if (id !== run.current) return
    if (!urls.length || typeof RTCPeerConnection === 'undefined') {
      setInfo(!urls.length ? '服务端未下发 STUN(已关闭或未配置)' : '当前浏览器不支持 WebRTC')
    } else {
      setStuns(urls.map(url => ({ url, state: 'run' })))
      await Promise.all(urls.map(async (url, i) => {
        const r = await probe(url).catch(() => null)
        setStuns(s => s.map((x, j) => j === i ? { url, state: r ? 'ok' : 'bad', ms: r?.ms, ip: r?.ip } : x))
      }))
    }
    setAt(new Date()); setBusy(false)
  }
  const avg = pts.length ? Math.round(pts.reduce((a, b) => a + b, 0) / pts.length) : null
  const min = pts.length ? Math.min(...pts) : null, max = pts.length ? Math.max(...pts) : null
  const jitter = pts.length > 1 ? Math.round(pts.slice(1).reduce((a, v, i) => a + Math.abs(v - pts[i]), 0) / (pts.length - 1)) : null
  const okN = stuns.filter(s => s.state === 'ok').length
  const done = stuns.length > 0 && stuns.every(s => s.state !== 'run')
  const lvl = (v: number | null) => v === null ? '' : v < 100 ? 'ok' : v < 300 ? 'warn' : 'bad'
  return (
    <div className="nw">
      <div className="page-head"><div className="page-head-text"><h1>网络与连通性诊断</h1><p className="sub">检测中继 API 延迟与各 STUN 服务器的 NAT 穿透能力{at && ` · 上次 ${at.toLocaleTimeString()}`}</p></div>
        <div className="page-head-actions"><button className="btn pri" onClick={start} disabled={busy}><Play size={15} />{busy ? '诊断中…' : '开始诊断'}</button></div></div>
      <div className="nw-stats">
        {[['平均延迟', avg, 'ms'], ['最低', min, 'ms'], ['最高', max, 'ms'], ['抖动', jitter, 'ms']].map(([l, v, u]: any) =>
          <div className="card" key={l}><h3>{l}</h3><div className={`stat nw-${l === '平均延迟' ? lvl(v) : ''}`}>{v ?? '-'}{v !== null && <small>{u}</small>}</div></div>)}
        <div className="card"><h3>丢包</h3><div className={`stat ${fails ? 'nw-bad' : ''}`}>{pts.length + fails ? `${fails}/${pts.length + fails}` : '-'}</div></div>
      </div>
      <div className="card"><h3><Activity size={15} />API 往返延迟({N} 次采样)</h3><Chart pts={pts} /></div>
      <div className="card"><div className="nw-hd"><h3>STUN / ICE 检测</h3>
        {stuns.length > 0 && <span className={`badge ${done ? (okN ? 'ok' : '') : 'warn'}`}><i />{done ? `${okN} / ${stuns.length} 可用` : '探测中…'}</span>}</div>
        {info && <div className="empty">{info}</div>}
        {!info && !stuns.length && <div className="empty">尚未检测</div>}
        <div className="nw-list">{stuns.map(s => (
          <div key={s.url} className="nw-item">{s.state === 'run' ? <span className="nw-spin" /> : s.state === 'ok' ? <CheckCircle2 size={16} className="nw-okc" /> : <XCircle size={16} className="nw-badc" />}
            <code>{s.url}</code><span className="nw-sp" />
            {s.state === 'ok' && <><span className="nw-ip">{s.ip}</span><span className={`badge ${lvl(s.ms ?? 0) === 'ok' ? 'ok' : ''}`}>{s.ms} ms</span></>}
            {s.state === 'bad' && <span className="badge">超时/不可达</span>}</div>))}</div>
        {done && !okN && <p className="hint nw-badc">所有 STUN 均不可达:P2P 将回退 TURN / Relay,请检查网络或 STUN 列表。</p>}
      </div>
    </div>)
}