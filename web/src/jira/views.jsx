// 뷰 4종: 목록(분할), 전체 목록(표), 보드(칸반), 백로그(스프린트)
import React, { useEffect, useMemo, useState } from 'react';
import { api, dt, Prio, Avatar, EpicBar, CatChips, StatusSelect, PRIORITY_ORDER } from './util.jsx';
import IssueDetail from './IssueDetail.jsx';
import { BoardModal } from './modals.jsx';

function useIssues(project, filters, bump, extraDep = null) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!project) return;
    const qs = new URLSearchParams({ project });
    for (const k of ['status', 'type', 'assignee', 'priority', 'sprint', 'q']) if (filters[k]) qs.set(k, filters[k]);
    api('/api/issues?' + qs).then(setRows);
  }, [project, JSON.stringify(filters), bump, extraDep]);
  return rows;
}

// ---------- 목록 (좌: 리스트 / 우: 상세) ----------
export function ListView({ project, meta, pdata, filters, bump, selKey, onOpen, onChanged, onTitle, onCount }) {
  const rows = useIssues(project, { ...filters, sprintOnly: undefined }, bump);
  useEffect(() => onCount(rows.length), [rows]);
  return (
    <div className="view on" id="view-list">
      <div id="list">
        {rows.map((r) => (
          <div className={`row${r.issue_key === selKey ? ' sel' : ''}`} key={r.id} onClick={() => onOpen(r.issue_key)}>
            <div className="top">
              <span className={`key${r.subtask ? ' sub' : ''}`}>{r.issue_key}</span>
              <span className="sum">{r.summary}</span>
            </div>
            <div className="meta">
              <span className={`badge cat-${r.status_category}`}>{r.status_name ?? '?'}</span>
              <span>{r.type_name ?? ''}</span><span>{r.assignee_name ?? '미지정'}</span><span>{dt(r.updated_at)}</span>
            </div>
          </div>))}
      </div>
      <div id="detail">
        {selKey
          ? <IssueDetail issueKey={selKey} meta={meta} pdata={pdata} onOpen={onOpen} onChanged={onChanged} onTitle={onTitle} />
          : <div className="placeholder">왼쪽 목록에서 이슈를 선택하세요</div>}
      </div>
    </div>
  );
}

// ---------- 전체 목록 (표) ----------
const TABLE_COLS = [
  ['key', '키'], ['summary', '업무'], ['type', '타입'], ['assignee', '담당자'], ['reporter', '보고자'],
  ['priority', '우선 순위'], ['status', '상태'], ['resolution', '해결'], ['created', '만듦'], ['updated', '업데이트됨'],
];
const keyNum = (k) => Number(String(k).split('-')[1] ?? 0);
const SORTERS = {
  key: (a, b) => keyNum(a.issue_key) - keyNum(b.issue_key),
  summary: (a, b) => (a.summary ?? '').localeCompare(b.summary ?? '', 'ko'),
  type: (a, b) => (a.type_name ?? '').localeCompare(b.type_name ?? '', 'ko'),
  assignee: (a, b) => (a.assignee_name ?? '힣힣').localeCompare(b.assignee_name ?? '힣힣', 'ko'),
  reporter: (a, b) => (a.reporter_name ?? '힣힣').localeCompare(b.reporter_name ?? '힣힣', 'ko'),
  priority: (a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9),
  status: (a, b) => (a.status_name ?? '').localeCompare(b.status_name ?? '', 'ko'),
  resolution: (a, b) => (a.resolution ?? '힣힣').localeCompare(b.resolution ?? '힣힣', 'ko'),
  created: (a, b) => new Date(a.created_at ?? 0) - new Date(b.created_at ?? 0),
  updated: (a, b) => new Date(a.updated_at ?? 0) - new Date(b.updated_at ?? 0),
};
const GROUPERS = {
  status: (r) => r.status_name ?? '(없음)',
  assignee: (r) => r.assignee_name ?? '(미지정)',
  type: (r) => r.type_name ?? '(없음)',
  epic: (r) => r.epic_key ? `${r.epic_key} ${r.epic_summary ?? ''}` : '(에픽 없음)',
  priority: (r) => r.priority ?? '(없음)',
};

export function TableView({ project, meta, filters, bump, onOpen, onChanged, onCount }) {
  const rows = useIssues(project, filters, bump);
  const [sort, setSort] = useState({ field: 'key', dir: -1 });
  useEffect(() => onCount(rows.length), [rows]);

  const ordered = useMemo(() => {
    const sorted = [...rows].sort((a, b) => sort.dir * SORTERS[sort.field](a, b));
    if (!filters.group) return sorted;
    const groups = new Map();
    for (const r of sorted) {
      const g = GROUPERS[filters.group](r);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(r);
    }
    const out = [];
    for (const [g, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko'))) {
      out.push({ __group: g, __count: list.length });
      out.push(...list);
    }
    return out;
  }, [rows, sort, filters.group]);

  const clickSort = (f) => setSort((s) => s.field === f ? { ...s, dir: -s.dir } : { field: f, dir: 1 });
  const changeStatus = async (r, id) => {
    await api('/api/issue/' + encodeURIComponent(r.issue_key), { method: 'PATCH', json: { statusId: id } });
    onChanged();
  };

  return (
    <div className="view on" id="view-table"><div id="tablewrap">
      <table className="issues">
        <thead><tr>{TABLE_COLS.map(([f, label]) => (
          <th key={f} onClick={() => clickSort(f)}>{label}
            {sort.field === f && <span className="arrow">{sort.dir > 0 ? '▲' : '▼'}</span>}</th>))}
        </tr></thead>
        <tbody>{ordered.map((r, i) => r.__group !== undefined
          ? <tr className="ghead" key={'g' + i}><td colSpan={TABLE_COLS.length}>{r.__group} <span className="dim">{r.__count}건</span></td></tr>
          : <tr key={r.id}>
              <td><span className={`ilink${r.status_category === 'done' ? ' done' : ''}`} onClick={() => onOpen(r.issue_key)}>{r.issue_key}</span></td>
              <td className="c-sum">{r.summary}</td>
              <td>{r.type_name ?? ''}</td>
              <td>{r.assignee_name ?? ''}</td>
              <td>{r.reporter_name ?? ''}</td>
              <td><Prio p={r.priority} /> {r.priority ?? ''}</td>
              <td><StatusSelect small statuses={meta.statuses} value={r.status_id} category={r.status_category}
                onChange={(id) => changeStatus(r, id)} /></td>
              <td>{r.resolution ?? (r.resolved_at ? '완료' : '')}</td>
              <td>{dt(r.created_at)}</td>
              <td>{dt(r.updated_at)}</td>
            </tr>)}
        </tbody>
      </table>
    </div></div>
  );
}

// ---------- 보드 (칸반) ----------
export function BoardView({ project, meta, pdata, filters, bump, onOpen, onChanged, onCount, reloadPdata }) {
  const rows = useIssues(project, filters, bump);
  const [boardId, setBoardId] = useState('');
  const [modal, setModal] = useState(null); // null | {board or undefined}
  const [dragKey, setDragKey] = useState(null);
  const [overCol, setOverCol] = useState(null);
  useEffect(() => onCount(rows.length), [rows]);
  useEffect(() => { if (!pdata.boards.some((b) => String(b.id) === boardId)) setBoardId(''); }, [pdata.boards]);

  const board = pdata.boards.find((b) => String(b.id) === boardId);
  const cols = board
    ? board.columns.map((c) => ({ name: c.name, statusIds: c.statusIds.map(Number), custom: true }))
    : meta.statuses.map((s) => ({ name: s.name, statusIds: [Number(s.id)], category: s.category }));
  const colOf = new Map();
  cols.forEach((c, i) => c.statusIds.forEach((s) => colOf.set(s, i)));
  const buckets = cols.map(() => []);
  let hidden = 0;
  for (const r of rows) {
    const i = colOf.get(Number(r.status_id));
    if (i == null) { hidden++; continue; }
    buckets[i].push(r);
  }
  const statusName = (id) => meta.statuses.find((s) => Number(s.id) === id)?.name ?? id;

  const drop = async (colIdx) => {
    setOverCol(null);
    if (!dragKey) return;
    const r = rows.find((x) => x.issue_key === dragKey);
    const c = cols[colIdx];
    if (!r || c.statusIds.includes(Number(r.status_id))) return;
    await api('/api/issue/' + encodeURIComponent(dragKey), { method: 'PATCH', json: { statusId: c.statusIds[0] } });
    onChanged();
  };
  const delBoard = async () => {
    if (!board) return alert('삭제할 보드를 선택하세요');
    if (!confirm(`보드 '${board.name}'을(를) 삭제할까요? (이슈는 삭제되지 않습니다)`)) return;
    await api('/api/boards/' + board.id, { method: 'DELETE' });
    setBoardId(''); reloadPdata();
  };

  return (
    <div className="view on" id="view-board">
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <div className="bbar">
          <select value={boardId} onChange={(e) => setBoardId(e.target.value)}>
            <option value="">기본 (모든 상태)</option>
            {pdata.boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button onClick={() => setModal({})}>+ 보드 만들기</button>
          <button onClick={() => board ? setModal({ board }) : alert('편집할 보드를 선택하세요 (기본 보드는 편집 불가)')}>편집</button>
          <button onClick={delBoard}>삭제</button>
          <span className="dim">{hidden ? `컬럼에 없는 상태의 이슈 ${hidden}건 숨김` : ''}</span>
        </div>
        <div id="board">
          {cols.map((c, i) => (
            <div className={`col${overCol === i ? ' dragover' : ''}`} key={i} title={c.statusIds.map(statusName).join(', ')}
              onDragOver={(e) => { e.preventDefault(); setOverCol(i); }}
              onDragLeave={() => setOverCol(null)}
              onDrop={(e) => { e.preventDefault(); drop(i); }}>
              <h4>{c.category ? <span className={`badge cat-${c.category}`}>{c.name}</span> : <b>{c.name}</b>}
                <span className="dim">{buckets[i].length}</span></h4>
              <div className="cards">
                {buckets[i].map((r) => (
                  <div className={`card${dragKey === r.issue_key ? ' dragging' : ''}`} key={r.id} draggable
                    onDragStart={() => setDragKey(r.issue_key)} onDragEnd={() => setDragKey(null)}>
                    <EpicBar r={r} />
                    <div className="sum">{r.summary}</div>
                    {(r.labels ?? []).length > 0 && <div className="labels">{r.labels.map((l) => <span className="chip" key={l}>{l}</span>)}</div>}
                    <div className="meta">
                      <span className={`ilink${r.status_category === 'done' ? ' done' : ''}`} onClick={() => onOpen(r.issue_key)}>{r.issue_key}</span>
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Prio p={r.priority} /><Avatar name={r.assignee_name} /></span>
                    </div>
                  </div>))}
              </div>
            </div>))}
        </div>
      </div>
      {modal && <BoardModal meta={meta} project={project} board={modal.board}
        onClose={() => setModal(null)}
        onSaved={(b) => { setModal(null); reloadPdata().then(() => setBoardId(String(b.id))); }} />}
    </div>
  );
}

// ---------- 백로그 (스프린트 + 인라인 계층) ----------
export function BacklogView({ project, meta, pdata, filters, bump, onOpen, onChanged, onCount, reloadPdata }) {
  const rows = useIssues(project, { ...filters, sprint: '' }, bump);
  const [expanded, setExpanded] = useState(() => new Set());
  useEffect(() => onCount(rows.length), [rows]);

  const bySprint = new Map();
  for (const r of rows) {
    const k = r.sprint_id ?? 'none';
    if (!bySprint.has(k)) bySprint.set(k, []);
    bySprint.get(k).push(r);
  }
  const open = pdata.sprints.filter((s) => s.state !== 'closed');

  const moveSprint = async (key, sprintId) => {
    await api('/api/issue/' + encodeURIComponent(key), { method: 'PATCH', json: { sprintId } });
    onChanged();
  };
  const changeStatus = async (key, id) => {
    await api('/api/issue/' + encodeURIComponent(key), { method: 'PATCH', json: { statusId: id } });
    onChanged();
  };
  const newSprint = async () => {
    const name = prompt('스프린트 이름'); if (!name?.trim()) return;
    const goal = prompt('목표 (선택)') ?? '';
    await api('/api/sprints', { method: 'POST', json: { projectKey: project, name, goal } });
    reloadPdata();
  };
  const sprintState = async (id, state, confirmMsg) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    await api('/api/sprints/' + id, { method: 'PATCH', json: { state } });
    reloadPdata(); onChanged();
  };

  const IssueRow = ({ r, child, twisty }) => (
    <div className={`srow${child ? ' child' : ''}`}>
      <EpicBar r={r} />
      {twisty}
      <span className={`key ilink${r.status_category === 'done' ? ' done' : ''}`} onClick={() => onOpen(r.issue_key)}>{r.issue_key}</span>
      <span className="sum">{r.summary}</span>
      {(r.fix_versions ?? []).map((v) => <span className="chip" key={v}>{v}</span>)}
      <StatusSelect small statuses={meta.statuses} value={r.status_id} category={r.status_category}
        onChange={(id) => changeStatus(r.issue_key, id)} />
      <Prio p={r.priority} />
      <Avatar name={r.assignee_name} />
      <select className="mv" value={r.sprint_id ?? ''} onChange={(e) => moveSprint(r.issue_key, e.target.value ? Number(e.target.value) : null)}>
        <option value="">백로그</option>
        {open.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </div>
  );

  const sectionRows = (list) => {
    const ids = new Set(list.map((r) => r.id));
    const childrenOf = new Map();
    for (const r of list) {
      if (r.subtask && r.parent_id && ids.has(r.parent_id)) {
        if (!childrenOf.has(r.parent_id)) childrenOf.set(r.parent_id, []);
        childrenOf.get(r.parent_id).push(r);
      }
    }
    const nested = new Set([...childrenOf.values()].flat().map((r) => r.id));
    return list.filter((r) => !nested.has(r.id)).map((r) => {
      const kids = childrenOf.get(r.id) ?? [];
      const isOpen = expanded.has(r.id);
      const twisty = kids.length > 0 && (
        <button className="twisty" title={`하위 작업 ${kids.length}개`}
          onClick={() => setExpanded((prev) => { const n = new Set(prev); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })}>
          {isOpen ? '▾' : '▸'}
        </button>);
      return (
        <React.Fragment key={r.id}>
          <IssueRow r={r} twisty={twisty || null} />
          {isOpen && kids.map((c) => <IssueRow r={c} child key={c.id} />)}
        </React.Fragment>
      );
    });
  };

  const SprintBlock = ({ s }) => {
    const list = bySprint.get(s.id) ?? [];
    return (
      <div className="sprint">
        <div className="shead">
          <b>{s.name}</b>
          <span className={`badge ${s.state === 'active' ? 'cat-indeterminate' : s.state === 'closed' ? 'cat-done' : 'cat-new'}`}>
            {{ future: '예정', active: '활성', closed: '완료' }[s.state]}</span>
          <span className="goal">{s.goal ?? ''}{s.start_at ? ` · ${dt(s.start_at)} 시작` : ''}</span>
          <span className="dim">{list.length}건</span>
          <CatChips rows={list} />
          {s.state === 'future' && <button onClick={() => sprintState(s.id, 'active')}>스프린트 시작</button>}
          {s.state === 'active' && <button onClick={() => sprintState(s.id, 'closed', '스프린트를 완료할까요? 미완료 이슈는 백로그로 돌아갑니다.')}>스프린트 완료</button>}
        </div>
        {list.length ? sectionRows(list) : <div className="sempty">이슈 없음 — 아래 백로그에서 이동하세요</div>}
      </div>
    );
  };

  const backlogList = bySprint.get('none') ?? [];
  return (
    <div className="view on" id="view-backlog"><div id="backlog">
      <div style={{ marginBottom: 12 }}><button className="primary" onClick={newSprint}>+ 스프린트 만들기</button></div>
      {pdata.sprints.filter((s) => s.state === 'active').map((s) => <SprintBlock s={s} key={s.id} />)}
      {pdata.sprints.filter((s) => s.state === 'future').map((s) => <SprintBlock s={s} key={s.id} />)}
      <div className="sprint">
        <div className="shead"><b>백로그</b><span className="dim">{backlogList.length}건</span><CatChips rows={backlogList} /></div>
        {backlogList.length ? sectionRows(backlogList) : <div className="sempty">백로그가 비어 있습니다</div>}
      </div>
      {pdata.sprints.filter((s) => s.state === 'closed').map((s) => <SprintBlock s={s} key={s.id} />)}
    </div></div>
  );
}
