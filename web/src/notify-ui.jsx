// 알림 화면 (GIRA-14) — Gira·Gonfluence 공용
//  NotifyRulesBody: 설정 › 알림 — 프로젝트/스페이스 관리자가 "어떤 이벤트를 어디로" 규칙을 정한다
//  NotifyBell: 상단 바 종 — 나와 관련된 알림(담당·보고·작성한 것)
import React, { useCallback, useEffect, useRef, useState } from 'react';
import './notify-ui.css';

async function req(path, opts = {}) {
  const res = await fetch(path, opts.json
    ? { ...opts, body: JSON.stringify(opts.json), headers: { 'content-type': 'application/json' } }
    : opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `오류 (${res.status})`);
  return body;
}

const ago = (t) => {
  const m = Math.floor((Date.now() - new Date(t).getTime()) / 60000);
  if (m < 1) return '방금 전';
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.floor(m / 60)}시간 전`;
  return new Date(t).toLocaleDateString('ko-KR');
};
const STATUS = { pending: '대기', sending: '보내는 중', sent: '보냄', failed: '실패', skipped: '건너뜀' };
// 웹훅 주소는 비밀에 가까우므로 호스트만 보여 준다
const maskTarget = (channel, target) => {
  if (channel !== 'teams') return target;
  if (!target) return '기본 웹훅 (TEAMS_WEBHOOK_URL)';
  try { return `${new URL(target).hostname} …`; } catch { return '(웹훅)'; }
};

export function NotifyRulesBody({ resourceKey, resourceLabel = '프로젝트' }) {
  const [cfg, setCfg] = useState(null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ events: [], channel: 'teams', target: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    req('/api/notify/config').then(setCfg).catch((e) => setErr(e.message));
    req(`/api/notify/rules?key=${encodeURIComponent(resourceKey)}`).then(setData).catch((e) => setErr(e.message));
  }, [resourceKey]);
  useEffect(load, [load]);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await req('/api/notify/rules', { method: 'POST', json: { key: resourceKey, ...form } });
      setForm({ events: [], channel: form.channel, target: '' });
      load();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  const act = async (fn) => { setErr(''); try { await fn(); load(); } catch (e) { setErr(e.message); } };
  const label = (ev) => cfg?.events.find((x) => x.value === ev)?.label ?? ev;
  const toggleEv = (v) => setForm((f) => ({ ...f, events: f.events.includes(v) ? f.events.filter((x) => x !== v) : [...f.events, v] }));

  if (!cfg || !data) return <div className="nt-dim">{err || '불러오는 중…'}</div>;
  return (
    <div className="nt-rules">
      <p className="nt-dim">이 {resourceLabel}에서 일어난 일을 Teams 채널·메일로 알립니다. 알림에는 제목과 링크만 담깁니다.
        관련된 사람(담당자·보고자·작성자)에게는 종(인앱) 알림이 따로 갑니다.</p>
      <div className="nt-chan">
        <span className={cfg.teams ? 'ok' : ''}>Teams 기본 웹훅: {cfg.teams ? '설정됨' : '없음 — 규칙에 웹훅 주소를 넣으세요'}</span>
        <span className={cfg.emailReady ? 'ok' : 'warn'}>메일: {cfg.email ? (cfg.emailReady ? '설정됨' : cfg.emailNote) : '설정 없음'}</span>
      </div>

      <h3>규칙</h3>
      {data.rules.length === 0 ? <div className="nt-dim">아직 규칙이 없습니다.</div> : (
        <table className="nt-table">
          <thead><tr><th>이벤트</th><th>보낼 곳</th><th>사용</th><th /></tr></thead>
          <tbody>{data.rules.map((r) => (
            <tr key={r.id} className={r.enabled ? '' : 'off'}>
              <td>{r.events.map(label).join(', ')}</td>
              <td>{r.channel === 'teams' ? 'Teams' : '메일'} · <span className="nt-target">{maskTarget(r.channel, r.target)}</span></td>
              <td><input type="checkbox" checked={r.enabled} aria-label="사용"
                onChange={(e) => act(() => req(`/api/notify/rules/${r.id}`, { method: 'PATCH', json: { enabled: e.target.checked } }))} /></td>
              <td className="nt-acts">
                <button type="button" onClick={() => act(() => req(`/api/notify/rules/${r.id}/test`, { method: 'POST' }))}>시험 발송</button>
                <button type="button" onClick={() => confirm('이 규칙을 지울까요?') && act(() => req(`/api/notify/rules/${r.id}`, { method: 'DELETE' }))}>삭제</button>
              </td>
            </tr>))}
          </tbody>
        </table>)}

      <form className="nt-form" onSubmit={add}>
        <div className="nt-row"><span className="nt-k">이벤트</span>
          <span className="nt-evs">{cfg.events.map((e) => (
            <label key={e.value}><input type="checkbox" checked={form.events.includes(e.value)} onChange={() => toggleEv(e.value)} /> {e.label}</label>))}
          </span></div>
        <div className="nt-row"><span className="nt-k">보낼 곳</span>
          <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value, target: '' })}>
            <option value="teams">Teams 채널</option>
            <option value="email">메일</option>
          </select>
          <input value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })}
            placeholder={form.channel === 'teams'
              ? (cfg.teams ? '채널 웹훅 주소 (비우면 기본 웹훅)' : '채널 웹훅 주소 (https://…webhook.office.com/… 등)')
              : '받는 주소(쉼표로) 또는 @assignee @reporter @author @watchers'} />
          {form.channel === 'email' && resourceLabel === '프로젝트' && <button type="button" onClick={() => setForm({ ...form, target: [form.target, '@watchers'].filter(Boolean).join(', ') })}>관찰자 추가</button>}
        </div>
        <div className="nt-row"><span className="nt-k" />
          <button type="submit" className="primary btn btn-primary" disabled={busy || !form.events.length}>규칙 추가</button>
          {err && <span className="nt-err">{err}</span>}
        </div>
      </form>

      <h3>최근 발송</h3>
      {data.recent.length === 0 ? <div className="nt-dim">아직 보낸 알림이 없습니다.</div> : (
        <table className="nt-table nt-recent">
          <tbody>{data.recent.map((m) => (
            <tr key={m.id}>
              <td className="nt-dim">{ago(m.created_at)}</td>
              <td>{m.event === 'test' ? '시험' : label(m.event)}</td>
              <td>{m.channel === 'teams' ? 'Teams' : '메일'}</td>
              <td className={`nt-st ${m.status}`} title={m.last_error ?? ''}>{STATUS[m.status] ?? m.status}{m.last_error ? ` — ${m.last_error}` : ''}</td>
            </tr>))}
          </tbody>
        </table>)}
    </div>
  );
}

// 상단 바 종: 1분마다 새 알림을 확인한다. 항목을 누르면 그 화면으로 가고 읽음 처리
export function NotifyBell({ onOpen, className = '', iconSize = 18, Icon }) {
  const [data, setData] = useState({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const load = useCallback(() => { req('/api/notifications').then(setData).catch(() => {}); }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 60_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const readAll = async () => { await req('/api/notifications/read', { method: 'POST', json: {} }).catch(() => {}); load(); };
  const go = async (n) => {
    setOpen(false);
    if (!n.read_at) req('/api/notifications/read', { method: 'POST', json: { ids: [n.id] } }).then(load).catch(() => {});
    onOpen?.(n.path);
  };
  return (
    <span className="nt-bellwrap" ref={wrap}>
      <button type="button" className={`nt-bell ${className}`} title="알림" aria-label={`알림 ${data.unread}건`}
        onClick={() => { setOpen((v) => !v); if (!open) load(); }}>
        {Icon ? <Icon size={iconSize} /> : '🔔'}
        {data.unread > 0 && <span className="nt-badge">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className="nt-pop" role="dialog" aria-label="알림">
          <div className="nt-pop-head"><b>알림</b>
            {data.unread > 0 && <button type="button" className="nt-link" onClick={readAll}>모두 읽음</button>}</div>
          {data.items.length === 0 ? <div className="nt-empty">새 알림이 없습니다.</div> : data.items.map((n) => (
            <button type="button" key={n.id} className={`nt-item${n.read_at ? '' : ' unread'}`} onClick={() => go(n)}>
              <span className="nt-item-top"><span className="nt-ev">{n.label}</span><span className="nt-dim">{ago(n.created_at)}</span></span>
              <span className="nt-item-title">{n.title}</span>
              {n.actor_name && <span className="nt-dim">{n.actor_name}</span>}
            </button>))}
        </div>)}
    </span>
  );
}
