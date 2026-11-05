// 개발참여 챗봇 (Gira/Gonfluence 공용): 바라는 점·버그를 자연어로 말하면 AI가 답하고,
// 필요한 작업은 GIRA 개발 프로젝트에 이슈(에픽~작업)로 자동 생성한다. 대화는 서버에 저장되어 이어진다.
import React, { useEffect, useRef, useState } from 'react';

export const SPEC_URL = 'https://claude.ai/artifact/RhWSzPu8SU2nTfhEJqHLDY';
const SESSION_KEY = 'devchat.session';

const TYPE_LABEL = { epic: '에픽', story: '스토리', task: '작업', subtask: '하위 작업', bug: '버그' };
const EXEC_LABEL = { codex: 'Codex', opencode: 'OpenCode', human: '사람' };

// 개발참여를 새 탭으로 연다 — 같은 이름의 탭을 재사용 (수정 확인을 위해 원래 화면을 새로고침해도 대화가 유지됨)
export function openDevChat() { window.open('/dev-chat', 'gira-devchat'); }

export function DevChatPage({ api, giraOrigin = '', appName = 'Gira', btn = 'btn', btnPrimary = 'btn btn-primary' }) {
  useEffect(() => { document.title = `개발참여 - ${appName}`; }, []);
  const [sessionId, setSessionId] = useState(() => {
    try { return Number(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; }
  });
  const [msgs, setMsgs] = useState([]); // {role, text, created?}
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);

  // 이전 대화 불러오기
  useEffect(() => {
    if (!sessionId) return;
    api(`/api/dev-chat/${sessionId}`, { quiet: true })
      .then((rows) => setMsgs(rows))
      .catch(() => { setSessionId(null); try { localStorage.removeItem(SESSION_KEY); } catch { /* 무시 */ } });
  }, []);
  useEffect(() => { listRef.current?.scrollTo(0, listRef.current.scrollHeight); }, [msgs, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    try {
      const r = await api('/api/dev-chat', { method: 'POST', json: { sessionId, message: text }, quiet: true });
      if (r.sessionId !== sessionId) {
        setSessionId(r.sessionId);
        try { localStorage.setItem(SESSION_KEY, String(r.sessionId)); } catch { /* 무시 */ }
      }
      setMsgs((m) => [...m, { role: 'assistant', text: r.reply, created: r.created }]);
    } catch (err) {
      setMsgs((m) => [...m, { role: 'error', text: err.message }]);
    } finally { setBusy(false); }
  };

  const newChat = () => {
    setSessionId(null); setMsgs([]);
    try { localStorage.removeItem(SESSION_KEY); } catch { /* 무시 */ }
  };

  return (
    <div className="devchat-page">
      <div className="devchat">
        <div className="devchat-head">
          <h2>개발참여</h2>
          <a href={SPEC_URL} target="_blank" rel="noreferrer">개발 명세서 ↗</a>
          <span className="devchat-sp" />
          <button className={btn} onClick={newChat} disabled={busy}>새 대화</button>
        </div>
        <div className="devchat-list" ref={listRef}>
          {!msgs.length && (
            <div className="devchat-empty">
              <strong>거 참 많이 답답하시죠?</strong><br />
              Gira·Gonfluence에 바라는 기능, 불편한 점, 버그를 편하게 말해 주세요.<br />
              필요한 작업은 GIRA 개발 프로젝트에 이슈로 등록되고, 처리 과정은 그 이슈에서 볼 수 있습니다.
              <div className="devchat-ex">예) "이슈 목록에서 마감일 순으로 정렬하고 싶어요" · "보드에서 카드를 끌면 가끔 원래 자리로 돌아가요"</div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={'devchat-msg devchat-' + m.role}>
              <div className="devchat-bubble">{m.text}</div>
              {m.created?.length > 0 && (
                <div className="devchat-issues">
                  {m.created.map((c) => (
                    <a key={c.key} className="devchat-issue" href={`${giraOrigin}/browse/${c.key}`} target="_blank" rel="noreferrer"
                      title={c.summary}>
                      <strong>{c.key}</strong> <span>{TYPE_LABEL[c.type] ?? c.type}</span>
                      <span className="devchat-sum">{c.summary}</span>
                      <span className="devchat-exec">{EXEC_LABEL[c.executor] ?? c.executor}
                        {c.needsApproval ? ' · 승인 필요' : c.autoStarted ? ' · 처리 시작됨' : ''}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="devchat-msg devchat-assistant"><div className="devchat-bubble devchat-typing">생각 중…</div></div>}
        </div>
        <div className="devchat-input">
          <textarea rows={3} value={input} onChange={(e) => setInput(e.target.value)} autoFocus
            placeholder="메시지 입력 (Enter 보내기, Shift+Enter 줄바꿈)"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
            }} />
          <button className={btnPrimary} onClick={send} disabled={busy || !input.trim()}>보내기</button>
        </div>
      </div>
    </div>
  );
}
