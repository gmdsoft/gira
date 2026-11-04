// 모달: 로그인 게이트, 이슈 만들기, 보드 만들기/편집
import React, { useEffect, useId, useRef, useState } from 'react';
import { api, Avatar, hashColor, Prio } from './util.jsx';
import { TypeIcon, IconClose, IconExpand, IconMore, IconPaperclip, IconGrid, IconBacklog, IconTag, IconUser, IconLink, IconInfo } from './icons.jsx';

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

// 다중 값 입력 (레이블·컴포넌트·수정 버전) — 칩 + 기존 값 자동완성(datalist)
function TagInput({ value, onChange, suggestions = [], placeholder }) {
  const [text, setText] = useState('');
  const listId = useId();
  const add = (raw) => {
    const t = String(raw ?? '').trim();
    if (!t) return;
    if (!value.includes(t)) onChange([...value, t]);
    setText('');
  };
  return (
    <div className="taginput" onClick={(e) => e.currentTarget.querySelector('input')?.focus()}>
      {value.map((t) => (
        <span className="chip" key={t}>{t}
          <button title="제거" onClick={() => onChange(value.filter((x) => x !== t))}>✕</button>
        </span>))}
      <input list={listId} value={text} placeholder={value.length ? '' : placeholder}
        onChange={(e) => {
          const v = e.target.value;
          // datalist 항목 클릭(또는 완전 일치 입력) 시 바로 추가
          if (suggestions.includes(v)) add(v); else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text); }
          else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => add(text)} />
      <datalist id={listId}>
        {suggestions.filter((s) => !value.includes(s)).map((s) => <option key={s} value={s} />)}
      </datalist>
    </div>
  );
}

export function NewIssueModal({ meta, pdata, project, me, onClose, onCreated, onRefresh }) {
  const [typeId, setTypeId] = useState(meta.types.find((t) => !t.subtask)?.id ?? meta.types[0]?.id);
  const [parentKey, setParentKey] = useState('');   // 하위 작업의 상위 이슈
  const [epicKey, setEpicKey] = useState('');       // 표준 타입의 상위 항목(에픽)
  const [summary, setSummary] = useState('');
  const [desc, setDesc] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [reporterId, setReporterId] = useState(me?.id ?? '');
  const [priority, setPriority] = useState(() => meta.priorities.includes('Normal') ? 'Normal' : (meta.priorities.includes('Medium') ? 'Medium' : ''));
  const [labels, setLabels] = useState([]);
  const [components, setComponents] = useState([]);
  const [fixVersions, setFixVersions] = useState([]);
  const [sprintId, setSprintId] = useState('');
  const [another, setAnother] = useState(false);    // Jira의 '다른 이슈 만들기'
  const [lastKey, setLastKey] = useState('');
  const [epics, setEpics] = useState([]);
  const [files, setFiles] = useState([]);
  const [fieldTab, setFieldTab] = useState('basic');
  const fileRef = useRef(null);
  const type = meta.types.find((t) => String(t.id) === String(typeId));
  const isSub = type?.subtask;
  const isEpic = type?.name === '에픽';
  const openSprints = pdata.sprints.filter((s) => s.state !== 'closed');
  const epicType = meta.types.find((t) => t.name === '에픽');
  const defaultStatus = meta.statuses.find((s) => s.category === 'new') ?? meta.statuses[0];
  const projName = meta.projects.find((p) => p.key === project)?.name ?? project;
  const reporterName = meta.assignees.find((u) => String(u.id) === String(reporterId))?.display_name ?? me?.display_name;
  const assigneeName = meta.assignees.find((u) => String(u.id) === String(assigneeId))?.display_name;

  useEffect(() => { // 상위 항목(에픽) 후보 — 최신순
    if (!epicType) return;
    api(`/api/issues?project=${encodeURIComponent(project)}&type=${epicType.id}&limit=500&sort=-key`)
      .then((d) => setEpics(d.rows)).catch(() => {});
  }, [project]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const addFiles = (list) => {
    const arr = Array.from(list ?? []);
    if (!arr.length) return;
    setFiles((prev) => [...prev, ...arr].slice(0, 5));
  };

  const create = async () => {
    if (!summary.trim()) return alert('요약을 입력하세요');
    const res = await api('/api/issues', { method: 'POST', json: {
      projectKey: project,
      typeId: Number(typeId),
      summary, description: desc,
      assigneeId: assigneeId ? Number(assigneeId) : null,
      reporterId: reporterId ? Number(reporterId) : null,
      priority: priority || null,
      labels, components, fixVersions,
      sprintId: sprintId ? Number(sprintId) : null,
      parentKey: isSub ? (parentKey.trim() || null) : (!isEpic && epicKey ? epicKey : null),
    } });
    for (const f of files) {
      const fd = new FormData(); fd.append('file', f);
      await api(`/api/issue/${encodeURIComponent(res.issueKey)}/attachments`, { method: 'POST', body: fd });
    }
    if (another) {
      setLastKey(res.issueKey); setSummary(''); setDesc(''); setFiles([]);
      onRefresh?.();
    } else onCreated(res.issueKey);
  };

  return (
    <div className="overlay on"><div className="modal create-modal">
      <div className="create-head">
        <div className="create-head-left">
          <span className="proj-mark" style={{ background: hashColor(project) }}>{project[0]}</span>
          <span className="create-proj">{project}</span>
          <span className="create-type">
            <TypeIcon name={type?.name} />
            <select value={typeId} onChange={(e) => setTypeId(e.target.value)} aria-label="작업 유형">
              {meta.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </span>
        </div>
        <div className="create-head-actions">
          <button className="iconbtn" title="최소화 (PoC 미지원)">–</button>
          <button className="iconbtn" title="최대화 (PoC 미지원)"><IconExpand size={14} /></button>
          <button className="iconbtn" title="더 보기 (PoC 미지원)"><IconMore size={16} /></button>
          <button className="iconbtn" title="닫기" onClick={onClose}><IconClose size={16} /></button>
        </div>
      </div>

      <div className="create-body">
        <label className="cf-label">요약 <span className="req">*</span><IconInfo size={12} className="cf-info" /></label>
        <textarea className="cf-summary" autoFocus rows={2} value={summary} placeholder="요약"
          onChange={(e) => setSummary(e.target.value)} />

        <label className="cf-label">설명 <IconInfo size={12} className="cf-info" /></label>
        <textarea className="cf-desc" value={desc}
          placeholder="설명을 추가하거나 /를 입력하여 작업 및 Rovo를 사용합니다"
          onChange={(e) => setDesc(e.target.value)} />

        <div className="cf-status">
          <span className={`status-dot cat-${defaultStatus?.category ?? 'new'}`} />
          <span>{defaultStatus?.name ?? '해야 할 일'}</span>
        </div>

        <div className="ctabs">
          {[['basic', '기본 입력'], ['more', '추가 정보'], ['qa', 'QA'], ['hubspot', 'HubSpot']].map(([k, label]) => (
            <button key={k} className={fieldTab === k ? 'on' : ''} onClick={() => setFieldTab(k)}>{label}</button>))}
        </div>

        {fieldTab === 'basic' ? <>
          <div className="cf-row">
            <div className="cf-label">스프린트</div>
            <div className="cf-value"><IconBacklog size={15} />
              <select value={sprintId} onChange={(e) => setSprintId(e.target.value)}>
                <option value="">스프린트</option>
                {openSprints.map((s) => <option key={s.id} value={s.id}>{s.name}{s.state === 'active' ? ' (활성)' : ''}</option>)}
              </select>
            </div>
          </div>
          <div className="cf-row">
            <div className="cf-label">우선 순위</div>
            <div className="cf-value"><Prio p={priority} />
              <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="">없음</option>
                {meta.priorities.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div className="cf-row">
            <div className="cf-label">담당자</div>
            <div className="cf-value">
              {assigneeName ? <Avatar name={assigneeName} /> : <IconUser size={15} />}
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">자동</option>
                {meta.assignees.map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}
              </select>
              {me && String(assigneeId) !== String(me.id) &&
                <button type="button" className="plain linklike" onClick={() => setAssigneeId(String(me.id))}>나에게 할당</button>}
            </div>
          </div>
          <div className="cf-row">
            <div className="cf-label">보고자 <span className="req">*</span></div>
            <div className="cf-value"><Avatar name={reporterName} />
              <select value={reporterId} onChange={(e) => setReporterId(e.target.value)}>
                {me && !meta.assignees.some((u) => String(u.id) === String(me.id))
                  && <option value={me.id}>{me.display_name}</option>}
                {meta.assignees.map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}
              </select>
            </div>
          </div>
          <div className="cf-row">
            <div className="cf-label">레이블</div>
            <div className="cf-value"><IconTag size={15} />
              <TagInput value={labels} onChange={setLabels} suggestions={pdata.labels ?? []} placeholder="레이블 입력 후 Enter" />
            </div>
          </div>
          <div className="cf-row">
            <div className="cf-label">컴포넌트</div>
            <div className="cf-value"><IconGrid size={15} />
              <TagInput value={components} onChange={setComponents} suggestions={pdata.components ?? []} placeholder="컴포넌트 입력 후 Enter" />
            </div>
          </div>
          <div className="cf-row">
            <div className="cf-label">수정 버전</div>
            <div className="cf-value"><IconBacklog size={15} />
              <TagInput value={fixVersions} onChange={setFixVersions} suggestions={(pdata.versions ?? []).map((v) => v.name)} placeholder="버전 입력 후 Enter" />
            </div>
          </div>
          {isSub ? <div className="cf-row">
            <div className="cf-label">상위 항목 <span className="req">*</span></div>
            <div className="cf-value"><IconLink size={15} />
              <input type="text" value={parentKey} placeholder={`${project}-10`} onChange={(e) => setParentKey(e.target.value)} />
            </div>
          </div> : !isEpic && <div className="cf-row">
            <div className="cf-label">상위 항목</div>
            <div className="cf-value"><IconLink size={15} />
              <select value={epicKey} onChange={(e) => setEpicKey(e.target.value)}>
                <option value="">없음</option>
                {epics.map((ep) => <option key={ep.id} value={ep.issue_key}>{ep.issue_key} — {ep.summary}</option>)}
              </select>
            </div>
          </div>}
          <div className="cf-row">
            <div className="cf-label">첨부 파일</div>
            <div className="cf-drop" onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
              <IconPaperclip size={16} /><span>첨부할 파일을 끌어놓거나 찾아보기</span>
              <input type="file" ref={fileRef} multiple hidden onChange={(e) => addFiles(e.target.files)} />
            </div>
            {files.length > 0 && <div className="cf-file-list">
              {files.map((f, i) => <div className="cf-file" key={f.name + i}>
                <IconPaperclip size={13} /><span>{f.name}</span>
                <button type="button" className="chip-x" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>×</button>
              </div>)}
            </div>}
          </div>
        </> : <div className="empty-fields">이 탭에 표시할 추가 필드가 없습니다.</div>}
      </div>

      <div className="create-foot">
        <button className="iconbtn" title="파일 첨부" onClick={() => fileRef.current?.click()}><IconPaperclip size={17} /></button>
        {lastKey && <span className="dim">{lastKey} 생성됨</span>}
        <label className="inlinechk"><input type="checkbox" checked={another} onChange={(e) => setAnother(e.target.checked)} /> 다른 항목 만들기</label>
        <button className="primary" onClick={create}>만들기</button>
      </div>
    </div></div>
  );
}

export function BoardModal({ meta, project, board, onClose, onSaved }) {
  const [name, setName] = useState(board?.name ?? '');
  const [jql, setJql] = useState(board?.jql ?? '');
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
      ? await api('/api/boards/' + board.id, { method: 'PATCH', json: { name, columns, jql } })
      : await api('/api/boards', { method: 'POST', json: { projectKey: project, name, columns, jql } });
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
      <label>보드 필터 (JQL, 선택) <span className="dim">— 보드에 담을 이슈를 제한 (예: component = MD-PLUG)</span></label>
      <input type="text" value={jql} spellCheck={false} style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12.5 }}
        placeholder='예: type != 에픽 AND labels = 1차병합' onChange={(e) => setJql(e.target.value)} />
      <div className="actions"><button onClick={onClose}>취소</button><button className="primary" onClick={save}>저장</button></div>
    </div></div>
  );
}
