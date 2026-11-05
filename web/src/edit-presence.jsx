// 편집 중 표시: 같은 문서를 다른 사람이 편집 중인지 알려 준다 (막지는 않는다 — 게시 시 충돌은 409 경고로 처리).
// 편집 화면은 30초마다 하트비트(POST)를 보내고 나갈 때 해제(DELETE)한다. 보기 화면은 30초마다 조회(GET)만 한다.
// 서버는 90초 동안 신호가 없으면 편집 중이 아닌 것으로 본다.
import React, { useEffect, useState } from 'react';

const INTERVAL = 30 * 1000;

export function useEditPresence(pageId, { editing = false } = {}) {
  const [editors, setEditors] = useState([]);
  useEffect(() => {
    if (!pageId) return undefined;
    let alive = true;
    const url = `/api/content/${pageId}/editing`;
    const tick = async () => {
      if (!editing && document.hidden) return; // 보기 화면은 탭이 가려져 있으면 조회를 쉰다
      try {
        const res = await fetch(url, { method: editing ? 'POST' : 'GET' });
        if (!res.ok) return;
        const body = await res.json();
        if (alive) setEditors(body.editors ?? []);
      } catch { /* 네트워크 오류는 다음 주기에 다시 */ }
    };
    tick();
    const timer = setInterval(tick, INTERVAL);
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    // 창을 닫을 때도 바로 해제되게 (keepalive — 실패해도 90초 뒤 자동 해제)
    const leave = () => { if (editing) fetch(url, { method: 'DELETE', keepalive: true }).catch(() => {}); };
    if (editing) window.addEventListener('pagehide', leave);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      if (editing) { window.removeEventListener('pagehide', leave); leave(); }
    };
  }, [pageId, editing]);
  return editors;
}

const names = (editors) => editors.map((e) => `${e.name ?? '알 수 없는 사용자'}님`).join(', ');

// 보기 화면: 제목 아래 메타 줄에 작게
export function EditingBadge({ editors }) {
  if (!editors?.length) return null;
  return <span className="editing-badge" title="이 문서를 지금 편집 중인 사람">✎ {names(editors)}이 편집 중</span>;
}

// 편집 화면: 상단 경고 띠
export function EditingWarning({ editors }) {
  if (!editors?.length) return null;
  return (
    <div className="editing-warning" role="status">
      <strong>{names(editors)}이 이 문서를 편집 중입니다.</strong>{' '}
      함께 고치면 나중에 게시하는 쪽이 충돌 경고를 받습니다 — 편집은 계속할 수 있습니다.
    </div>
  );
}
