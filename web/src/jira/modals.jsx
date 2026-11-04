// 모달: 로그인 게이트, 이슈 만들기, 보드 만들기/편집
import React, { useEffect, useState } from 'react';
import { api } from './util.jsx';

export function LoginGate({ onLogin }) {
  const [users, setUsers] = useState([]);
  useEffect(() => { fetch('/api/auth/users').then((r) => r.json()).then(setUsers).catch(() => {}); }, []);
  const login = async (id) => {
    await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: id }) });
    onLogin();
  };
  return (
    <div className="overlay on"><div className="modal" style={{ width: 360, textAlign: 'center' }}>
      <h2>로그인</h2>
      <div className="dim" style={{ marginBottom: 10 }}>계정을 선택하세요 (개발용)</div>
      {users.length
        ? users.map((u) => <button className="acct" key={u.id} onClick={() => login(u.id)}>{u.display_name}</button>)
        : <div className="dim">계정이 없습니다</div>}
    </div></div>
  );
}

export function NewIssueModal({ meta, pdata, project, onClose, onCreated }) {
  const [typeId, setTypeId] = useState(meta.types.find((t) => !t.subtask)?.id ?? meta.types[0]?.id);
  const [parentKey, setParentKey] = useState('');
  const [summary, setSummary] = useState('');
  const [desc, setDesc] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [priority, setPriority] = useState('');
  const [sprintId, setSprintId] = useState('');
  const isSub = meta.types.find((t) => String(t.id) === String(typeId))?.subtask;
  const openSprints = pdata.sprints.filter((s) => s.state !== 'closed');

  const create = async () => {
    const res = await api('/api/issues', { method: 'POST', json: {
      projectKey: project,
      typeId: Number(typeId),
      summary, description: desc,
      assigneeId: assigneeId ? Number(assigneeId) : null,
      priority: priority || null,
      sprintId: sprintId ? Number(sprintId) : null,
      parentKey: isSub ? parentKey : null,
    } });
    onCreated(res.issueKey);
  };

  return (
    <div className="overlay on"><div className="modal">
      <h2>이슈 만들기</h2>
      <label>타입</label>
      <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
        {meta.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {isSub && <>
        <label>상위 이슈 키 (하위 작업용, 예: {project}-10)</label>
        <input type="text" value={parentKey} placeholder={`${project}-10`} onChange={(e) => setParentKey(e.target.value)} />
      </>}
      <label>요약 *</label>
      <input type="text" value={summary} onChange={(e) => setSummary(e.target.value)} />
      <label>설명</label>
      <textarea placeholder="플레인 텍스트 (PoC)" value={desc} onChange={(e) => setDesc(e.target.value)} />
      <label>담당자</label>
      <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
        <option value="">미지정</option>
        {meta.assignees.map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}
      </select>
      <label>우선순위</label>
      <select value={priority} onChange={(e) => setPriority(e.target.value)}>
        <option value="">없음</option>
        {meta.priorities.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <label>스프린트</label>
      <select value={sprintId} onChange={(e) => setSprintId(e.target.value)}>
        <option value="">백로그</option>
        {openSprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <div className="actions"><button onClick={onClose}>취소</button><button className="primary" onClick={create}>만들기</button></div>
    </div></div>
  );
}

export function BoardModal({ meta, project, board, onClose, onSaved }) {
  const [name, setName] = useState(board?.name ?? '');
  const [cols, setCols] = useState(() => board?.columns?.map((c) => ({ name: c.name, statusIds: c.statusIds.map(Number) }))
    ?? [{ name: '해야 할 일', statusIds: [] }, { name: '대기', statusIds: [] }, { name: '진행 중', statusIds: [] }, { name: '완료', statusIds: [] }]);

  const setColName = (i, v) => setCols((cs) => cs.map((c, j) => j === i ? { ...c, name: v } : c));
  const toggleStatus = (i, sid) => setCols((cs) => cs.map((c, j) => {
    if (j !== i) return c;
    const has = c.statusIds.includes(sid);
    return { ...c, statusIds: has ? c.statusIds.filter((x) => x !== sid) : [...c.statusIds, sid] };
  }));
  const save = async () => {
    if (!name.trim()) return alert('보드 이름을 입력하세요');
    const columns = cols.filter((c) => c.name.trim() || c.statusIds.length);
    const saved = board
      ? await api('/api/boards/' + board.id, { method: 'PATCH', json: { name, columns } })
      : await api('/api/boards', { method: 'POST', json: { projectKey: project, name, columns } });
    onSaved(saved);
  };

  return (
    <div className="overlay on"><div className="modal">
      <h2>{board ? '보드 편집' : '보드 만들기'}</h2>
      <label>보드 이름 *</label>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      <label>컬럼 구성 * <span className="dim">(각 컬럼에 포함할 상태 선택, 상태는 한 컬럼에만)</span></label>
      {cols.map((c, i) => (
        <div className="bm-col" key={i}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="text" placeholder="컬럼 이름" value={c.name} style={{ flex: 1 }} onChange={(e) => setColName(i, e.target.value)} />
            <button title="컬럼 삭제" onClick={() => setCols((cs) => cs.filter((_, j) => j !== i))}>✕</button>
          </div>
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
            {meta.statuses.map((s) => (
              <label key={s.id} style={{ fontSize: 12, margin: 0, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                <input type="checkbox" checked={c.statusIds.includes(Number(s.id))} onChange={() => toggleStatus(i, Number(s.id))} />
                <span className={`badge cat-${s.category}`}>{s.name}</span>
              </label>))}
          </div>
        </div>))}
      <button style={{ marginTop: 8 }} onClick={() => setCols((cs) => [...cs, { name: '', statusIds: [] }])}>+ 컬럼 추가</button>
      <div className="actions"><button onClick={onClose}>취소</button><button className="primary" onClick={save}>저장</button></div>
    </div></div>
  );
}
