// 개발참여 모달 (Gira/Gonfluence 공용): 신규 기능·수정 요청·버그를 입력하면
// Gira의 GIRA 개발 프로젝트에 이슈로 등록된다. 개발 명세서 링크 포함.
import React, { useState } from 'react';

export const SPEC_URL = 'https://claude.ai/artifact/RhWSzPu8SU2nTfhEJqHLDY';

export function DevFeedbackModal({ api, giraOrigin = '', onClose, modalClass = 'modal', btn = 'btn', btnPrimary = 'btn btn-primary' }) {
  const [kind, setKind] = useState('feature');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // 등록된 이슈 키

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      const r = await api('/api/dev-feedback', { method: 'POST', json: { kind, title, detail }, quiet: true });
      setDone(r.issueKey);
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={() => onClose()}>
      <div className={modalClass + ' devfb'} onClick={(e) => e.stopPropagation()}>
        <h2>개발참여</h2>
        <p className="devfb-hint">Gira·Gonfluence에 바라는 기능, 고칠 점, 버그를 알려주세요.
          GIRA 개발 프로젝트에 이슈로 등록되어 처리 과정이 공개됩니다.{' '}
          <a href={SPEC_URL} target="_blank" rel="noreferrer">개발 명세서 ↗</a></p>
        {done ? (
          <p className="devfb-done">✅ 등록되었습니다:{' '}
            <a href={`${giraOrigin}/browse/${done}`} target="_blank" rel="noreferrer"><strong>{done}</strong></a>
            {' '}— 진행 상황은 GIRA 프로젝트에서 볼 수 있습니다.</p>
        ) : (
          <form className="devfb-form" onSubmit={submit}>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="feature">신규 기능</option>
              <option value="change">수정 요청</option>
              <option value="bug">버그</option>
            </select>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목 (한 줄 요약)" autoFocus />
            <textarea rows={6} value={detail} onChange={(e) => setDetail(e.target.value)}
              placeholder={'자세한 내용\n- 버그라면: 어떤 화면에서, 무엇을 했을 때, 어떻게 되는지\n- 기능이라면: 어떤 일을 하고 싶은지'} />
            <button className={btnPrimary} type="submit" disabled={busy || !title.trim()}>
              {busy ? '등록 중…' : '이슈로 등록'}
            </button>
          </form>
        )}
        <div className="modal-actions"><button className={btn} onClick={() => onClose()}>닫기</button></div>
      </div>
    </div>
  );
}
