// 팀장 셀프 이관 모달 (Gira/Gonfluence 공용 — api 함수와 버튼 클래스만 주입)
// 흐름: 본인 Atlassian API 토큰 등록 → 원본 목록에서 선택 → 백그라운드 이관 + 로그 폴링
import React, { useEffect, useRef, useState } from 'react';

export function MigrateModal({ api, title, resourceLabel, onClose, onDone, btn = 'btn', btnPrimary = 'btn btn-primary' }) {
  const [token, setToken] = useState(undefined); // undefined=로딩, {hasToken, email?}
  const [email, setEmail] = useState('');
  const [tok, setTok] = useState('');
  const [remote, setRemote] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [openLog, setOpenLog] = useState(null);
  const [busy, setBusy] = useState(false);
  const doneRef = useRef(false);

  const loadToken = () => api('/api/migrate/token', { quiet: true }).then(setToken).catch(() => setToken({ hasToken: false }));
  const loadRemote = () => api('/api/migrate/remote', { quiet: true }).then(setRemote)
    .catch((e) => { setRemote([]); if (!e?.body?.needToken) alert(e.message); });
  const loadJobs = () => api('/api/migrate/jobs', { quiet: true }).then(setJobs).catch(() => {});
  useEffect(() => { loadToken(); loadJobs(); }, []);
  useEffect(() => { if (token?.hasToken) loadRemote(); }, [token?.hasToken]);

  // 진행 중 작업이 있으면 3초 폴링, 완료되면 목록 갱신
  const running = jobs.some((j) => j.status === 'running');
  useEffect(() => {
    if (!running) {
      if (doneRef.current) { doneRef.current = false; loadRemote(); onDone?.(); }
      return undefined;
    }
    doneRef.current = true;
    const t = setInterval(loadJobs, 3000);
    return () => clearInterval(t);
  }, [running]);

  const saveToken = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/migrate/token', { method: 'POST', json: { email, token: tok }, quiet: true });
      setTok(''); loadToken();
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  };
  const dropToken = async () => {
    if (!confirm('등록한 토큰을 삭제할까요?')) return;
    await api('/api/migrate/token', { method: 'DELETE' });
    setToken({ hasToken: false }); setRemote(null);
  };
  const run = async (r) => {
    if (!confirm(`${r.key} (${r.name}) 을(를) 가져올까요?\n원본은 읽기만 하며, 완료되면 내가 관리자가 됩니다.`)) return;
    try { await api('/api/migrate/run', { method: 'POST', json: { key: r.key }, quiet: true }); loadJobs(); }
    catch (e) { alert(e.message); }
  };

  const STATUS = { running: '진행 중…', done: '완료', error: '오류' };
  return (
    <div className="modal-backdrop" onClick={() => onClose()}>
      <div className="modal perm-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {token === undefined ? <p className="mg-muted">불러오는 중…</p> : !token.hasToken ? (
          <form className="mg-token" onSubmit={saveToken}>
            <p className="mg-muted">본인 Atlassian 계정의 API 토큰을 등록하세요
              (<a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer">발급 페이지 ↗</a>).
              원본은 읽기 전용으로만 접근하며, 토큰은 암호화 저장되고 다시 표시되지 않습니다.</p>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Atlassian 이메일" />
            <input value={tok} onChange={(e) => setTok(e.target.value)} placeholder="API 토큰" type="password" />
            <button className={btnPrimary} type="submit" disabled={busy || !email.trim() || !tok.trim()}>
              {busy ? '확인 중…' : '토큰 등록'}
            </button>
          </form>
        ) : (
          <p className="mg-muted">토큰: <strong>{token.email}</strong>
            {' '}<button className={btn} onClick={dropToken}>삭제</button></p>
        )}

        {token?.hasToken && (
          <div className="mg-body">
            <h3>원본 {resourceLabel} 선택</h3>
            {!remote ? <p className="mg-muted">원본 목록 불러오는 중…</p> : (
              <ul className="mg-list">
                {remote.map((r) => (
                  <li key={r.key}>
                    <span className="mg-key">{r.key}</span>
                    <span className="mg-name">{r.name}</span>
                    {r.exists ? <span className="mg-exists">이관됨</span>
                      : <button className={btnPrimary} disabled={running} onClick={() => run(r)}>가져오기</button>}
                  </li>
                ))}
                {!remote.length && <li className="mg-muted">원본에서 가져올 수 있는 {resourceLabel}이(가) 없습니다</li>}
              </ul>
            )}
          </div>
        )}

        {jobs.length > 0 && <>
          <h3>이관 작업</h3>
          <ul className="mg-jobs">
            {jobs.map((j) => (
              <li key={j.id}>
                <span className="mg-key">{j.target}</span>
                <span className={'mg-status mg-' + j.status}>{STATUS[j.status]}</span>
                <span className="mg-muted">{new Date(j.created_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                <button className={btn} onClick={() => setOpenLog(openLog === j.id ? null : j.id)}>
                  {openLog === j.id ? '로그 닫기' : '로그'}
                </button>
                {openLog === j.id && <pre className="mg-log">{j.log || '(로그 없음)'}</pre>}
              </li>
            ))}
          </ul>
        </>}
        <div className="modal-actions"><button className={btn} onClick={() => onClose()}>닫기</button></div>
      </div>
    </div>
  );
}
