// 개발참여 챗봇 (Gira/Gonfluence 공용): 바라는 점·버그를 자연어(+스크린샷·로그 첨부)로 말하면 AI가 답하고,
// 필요한 작업은 GIRA 개발 프로젝트에 이슈(에픽~작업)로 등록한다(등록까지만). 대화는 서버에 저장되어 이어진다.
import React, { useEffect, useRef, useState } from 'react';

// 개발 명세서: Gonfluence GIRA 스페이스 › 개발문서 (원본). 저장소 docs/alpha-spec.md는 scripts/spec-sync.mjs로 만든 사본
export const SPEC_PAGE_ID = '1000000000009';
export const SPEC_URL = `${location.protocol}//${location.hostname}:3001/s/GIRA/p/${SPEC_PAGE_ID}`;
export const REPO_URL = 'https://github.com/gmdsoft/gira';
const SESSION_KEY = 'devchat.session';

const TYPE_LABEL = { epic: '에픽', story: '스토리', task: '작업', subtask: '하위 작업', bug: '버그' };
const MAX_FILES = 5;
const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB');

// 개발참여를 새 탭으로 연다 — 같은 이름의 탭을 재사용 (수정 확인을 위해 원래 화면을 새로고침해도 대화가 유지됨).
// 연 화면의 주소를 ?from= 으로 넘겨 등록 이슈의 '환경 정보'에 남긴다
export function openDevChat() {
  window.open('/dev-chat?from=' + encodeURIComponent(location.href), 'gira-devchat');
}

// 빌드 정보 (vite define — 없으면 '알 수 없음')
// eslint-disable-next-line no-undef
const BUILD = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : '';

// 챗봇을 연 원래 화면·브라우저·앱 정보 (서버가 이슈 설명 끝에 '환경 정보'로 붙인다)
function clientEnv(appName) {
  let from = '';
  try { from = new URLSearchParams(location.search).get('from') || ''; } catch { /* 무시 */ }
  const ua = navigator.userAgentData;
  return {
    url: from,
    app: appName,
    build: BUILD,
    userAgent: navigator.userAgent,
    platform: ua?.platform || navigator.platform || '',
    language: navigator.language || '',
    screen: `${window.screen?.width ?? '?'}x${window.screen?.height ?? '?'} (창 ${window.innerWidth}x${window.innerHeight}, 배율 ${window.devicePixelRatio ?? 1})`,
  };
}

export function DevChatPage({ api, giraOrigin = '', appName = 'Gira', btn = 'btn', btnPrimary = 'btn btn-primary' }) {
  useEffect(() => { document.title = `개발참여 - ${appName}`; }, []);
  const [sessionId, setSessionId] = useState(() => {
    try { return Number(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; }
  });
  const [msgs, setMsgs] = useState([]); // {role, text, created?}
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState([]); // 보낼 첨부 {tmp, id?, filename, size, error?}
  const [dragging, setDragging] = useState(false);
  const listRef = useRef(null);
  const fileInput = useRef(null);
  const uploading = files.some((f) => !f.id && !f.error);

  // 파일 선택·붙여넣기·끌어놓기 → 바로 올리고 번호를 받아 둔다
  const addFiles = (list) => {
    const picked = [...list].slice(0, Math.max(0, MAX_FILES - files.length));
    if (list.length > picked.length) alert(`첨부는 한 번에 ${MAX_FILES}개까지입니다`);
    for (const file of picked) {
      const tmp = Math.random().toString(36).slice(2);
      const filename = file.name || `붙여넣은 이미지.${(file.type.split('/')[1] || 'png')}`;
      setFiles((fs) => [...fs, { tmp, filename, size: file.size }]);
      if (file.size > 20 * 1024 * 1024) {
        setFiles((fs) => fs.map((f) => (f.tmp === tmp ? { ...f, error: '20MB 초과' } : f)));
        continue;
      }
      const form = new FormData();
      form.append('file', file, filename);
      api('/api/dev-chat/files', { method: 'POST', body: form, quiet: true })
        .then((r) => setFiles((fs) => fs.map((f) => (f.tmp === tmp ? { ...f, id: r.id } : f))))
        .catch((err) => setFiles((fs) => fs.map((f) => (f.tmp === tmp ? { ...f, error: err.message } : f))));
    }
  };
  const onPaste = (e) => {
    const list = [...(e.clipboardData?.files ?? [])];
    if (list.length) { e.preventDefault(); addFiles(list); }
  };

  // 이전 대화 불러오기
  useEffect(() => {
    if (!sessionId) return;
    api(`/api/dev-chat/${sessionId}`, { quiet: true })
      .then((rows) => setMsgs(rows))
      .catch(() => { setSessionId(null); try { localStorage.removeItem(SESSION_KEY); } catch { /* 무시 */ } });
  }, []);
  useEffect(() => { listRef.current?.scrollTo(0, listRef.current.scrollHeight); }, [msgs, busy]);

  const ready = files.filter((f) => f.id);
  const send = async () => {
    const text = input.trim();
    if ((!text && !ready.length) || busy || uploading) return;
    setInput('');
    setFiles([]);
    setMsgs((m) => [...m, { role: 'user', text, files: ready.map((f) => f.filename) }]);
    setBusy(true);
    try {
      const r = await api('/api/dev-chat', {
        method: 'POST', json: { sessionId, message: text, fileIds: ready.map((f) => f.id), env: clientEnv(appName) }, quiet: true,
      });
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
    setSessionId(null); setMsgs([]); setFiles([]);
    try { localStorage.removeItem(SESSION_KEY); } catch { /* 무시 */ }
  };

  return (
    <div className="devchat-page">
      <div className={'devchat' + (dragging ? ' devchat-drop' : '')}
        onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragging(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
        onDrop={(e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); } }}>
        <div className="devchat-head">
          <h2>개발참여</h2>
          <a href={SPEC_URL} target="_blank" rel="noreferrer">개발 명세서 ↗</a>
          <a href={REPO_URL} target="_blank" rel="noreferrer">저장소 ↗</a>
          <span className="devchat-sp" />
          <button className={btn} onClick={newChat} disabled={busy}>새 대화</button>
        </div>
        <div className="devchat-list" ref={listRef}>
          {!msgs.length && (
            <div className="devchat-empty">
              <strong>거 참 많이 답답하시죠?</strong><br />
              Gira·Gonfluence에 바라는 기능, 불편한 점, 버그를 편하게 말해 주세요.<br />
              내용을 정리해 GIRA 개발 프로젝트에 이슈로 등록하면, 처리 에이전트가 바로 분석해 처리를 시작합니다.<br />
              스크린샷이나 로그는 왼쪽 클립 버튼, 붙여넣기(Ctrl+V), 끌어놓기로 첨부할 수 있습니다.
              <ol className="devchat-flow">
                <li>처리가 끝나면 이슈가 <b>검토</b>로 바뀌어 나에게 할당되고, 테스트 서버 링크를 메일·댓글로 받습니다.</li>
                <li>테스트 서버에서 확인하고, 고칠 점은 이슈 <b>댓글</b>로 남기면 반영해 다시 검토를 요청합니다.</li>
                <li>괜찮으면 "확인했습니다"라고 댓글을 달거나 <b>완료</b>로 바꾸세요. 개발 브랜치에 합쳐지고, 운영 반영은 관리자가 합니다.</li>
              </ol>
              <span className="devchat-note">명세서 범위를 넘는 요청은 관리자 승인 후 시작됩니다.</span>
              <div className="devchat-ex">예) "이슈 목록에서 마감일 순으로 정렬하고 싶어요" · "보드에서 카드를 끌면 가끔 원래 자리로 돌아가요"</div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={'devchat-msg devchat-' + m.role}>
              {(m.text || !m.files?.length) && <div className="devchat-bubble">{m.text}</div>}
              {m.files?.length > 0 && (
                <div className="devchat-files">{m.files.map((f, j) => <span key={j} className="devchat-file">📎 {f}</span>)}</div>
              )}
              {m.created?.length > 0 && (
                <div className="devchat-issues">
                  {m.created.map((c) => (
                    <a key={c.key} className="devchat-issue" href={`${giraOrigin}/browse/${c.key}`} target="_blank" rel="noreferrer"
                      title={c.summary}>
                      <strong>{c.key}</strong> <span>{TYPE_LABEL[c.type] ?? c.type}</span>
                      <span className="devchat-sum">{c.summary}</span>
                      <span className="devchat-exec">{c.priority ? `${c.priority} · ` : ''}{c.needsApproval ? '승인 필요' : '등록됨'}
                        {c.attachments?.length ? ` · 첨부 ${c.attachments.length}` : ''}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="devchat-msg devchat-assistant"><div className="devchat-bubble devchat-typing">생각 중…</div></div>}
        </div>
        {files.length > 0 && (
          <div className="devchat-files devchat-pending">
            {files.map((f) => (
              <span key={f.tmp} className={'devchat-file' + (f.error ? ' devchat-file-err' : '')}
                title={f.error ?? ''}>
                📎 {f.filename} <span className="devchat-fsize">{f.error ? f.error : f.id ? fmtSize(f.size) : '올리는 중…'}</span>
                <button type="button" aria-label="첨부 빼기" onClick={() => setFiles((fs) => fs.filter((x) => x.tmp !== f.tmp))}>×</button>
              </span>
            ))}
          </div>
        )}
        <div className="devchat-input">
          <button type="button" className="devchat-attach" title="파일 첨부 (스크린샷·로그 등, 최대 5개)" aria-label="파일 첨부"
            onClick={() => fileInput.current?.click()} disabled={busy || files.length >= MAX_FILES}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            {files.length > 0 && <span className="devchat-attach-n">{files.length}</span>}
          </button>
          <input ref={fileInput} type="file" multiple hidden
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          <textarea rows={3} value={input} onChange={(e) => setInput(e.target.value)} autoFocus onPaste={onPaste}
            placeholder="메시지 입력 (Enter 보내기, Shift+Enter 줄바꿈, 이미지 붙여넣기 가능)"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
            }} />
          <button className={btnPrimary} onClick={send}
            disabled={busy || uploading || (!input.trim() && !ready.length)}>보내기</button>
        </div>
      </div>
    </div>
  );
}
