// 뷰 4종: 목록(분할), 전체 목록(표), 보드(칸반), 백로그(스프린트)
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, dt, Prio, Avatar, EpicBar, CatChips, StatusSelect, hashColor, PRIORITY_ORDER } from './util.jsx';
import { TypeIcon } from './icons.jsx';
import { IconCheck, IconMore, IconChevronRight, IconChevronDown } from './icons.jsx';
import IssueDetail from './IssueDetail.jsx';
import { BoardModal } from './modals.jsx';

// 이슈 목록 훅. pageSize를 주면 스크롤 추가 로드(fetchMore), 없으면 한 번에 최대 1000건.
function useIssues(project, filters, bump, { sort = null, pageSize = 0, extraJql = [] } = {}) {
  const [data, setData] = useState({ total: 0, rows: [] });
  const [loading, setLoading] = useState(false);
  const seq = useRef(0); // 필터/정렬 변경 후 도착하는 이전 요청 응답 무시용
  const qs = (offset, limit) => {
    const u = new URLSearchParams({ project, offset, limit });
    if (filters.jql) u.append('jql', filters.jql); // 고급(JQL) 모드 — 기본 필터와 병행하지 않음
    else {
      for (const k of ['status', 'type', 'assignee', 'priority', 'sprint', 'q']) if (filters[k]) u.set(k, filters[k]);
      if (filters.xjql) u.append('jql', filters.xjql); // 기본 모드로 못 옮긴 잔여 JQL — AND 결합
    }
    // 아바타 빠른 필터: 기본/JQL 모드와 무관하게 '이 프로젝트에서 이 사람이 담당' 으로 AND 적용
    if (filters.who) u.set('who', filters.who);
    for (const x of extraJql) if (x) u.append('jql', x); // 보드 필터 등 — AND 결합
    if (sort) u.set('sort', sort);
    return u;
  };
  useEffect(() => {
    if (!project) return;
    const my = ++seq.current;
    setLoading(true);
    api('/api/issues?' + qs(0, pageSize || 1000)).then((d) => {
      if (seq.current !== my) return;
      setData(d); setLoading(false);
    });
  }, [project, JSON.stringify(filters), bump, sort, JSON.stringify(extraJql)]);
  const fetchMore = () => {
    if (!pageSize || loading || data.rows.length >= data.total) return;
    const my = seq.current;
    setLoading(true);
    api('/api/issues?' + qs(data.rows.length, pageSize)).then((d) => {
      if (seq.current !== my) return;
      setData((cur) => ({ total: d.total, rows: [...cur.rows, ...d.rows] }));
      setLoading(false);
    });
  };
  return { rows: data.rows, total: data.total, loading, fetchMore };
}

// 스크롤이 바닥 근처에 오면 fetchMore 호출
const nearBottom = (el, px = 400) => el.scrollTop + el.clientHeight >= el.scrollHeight - px;

// 목록 하단 고정 푸터 (Jira 목록 뷰의 '+ 만들기 / N 중 M / 새로고침')
function ListFoot({ total, shown, loading, onNew, onRefresh }) {
  return (
    <div className="lfoot">
      <button className="plain" onClick={onNew}>+ 만들기</button>
      <span className="dim" style={{ marginLeft: 'auto' }}>
        {total ? `${total.toLocaleString()} 중 ${shown.toLocaleString()}` : '0건'}{loading ? ' · 불러오는 중…' : ''}
      </span>
      <button className="plain" title="새로고침" onClick={onRefresh}>⟳</button>
    </div>
  );
}

// ---------- 목록 (좌: 리스트 / 우: 상세) ----------
export function ListView({ project, meta, pdata, me, filters, bump, selKey, onOpen, onChanged, onTitle, onCount, onSeen, onNew, boardJql }) {
  const { rows, total, loading, fetchMore } = useIssues(project, filters, bump, { pageSize: 100, extraJql: [boardJql] });
  const [paneWidth, setPaneWidth] = useState(() => {
    const v = Number(localStorage.getItem('jira.listPaneWidth'));
    return Number.isFinite(v) && v >= 280 ? v : 440;
  });
  const [paneResize, setPaneResize] = useState(null);
  useEffect(() => onCount(total), [total]);
  useEffect(() => { try { localStorage.setItem('jira.listPaneWidth', String(paneWidth)); } catch { /* 무시 */ } }, [paneWidth]);
  useEffect(() => {
    if (!paneResize) return;
    const onMove = (e) => {
      const max = Math.max(280, Math.min(900, window.innerWidth - 360));
      setPaneWidth(Math.max(280, Math.min(max, paneResize.startW + e.clientX - paneResize.startX)));
    };
    const onUp = () => { setPaneResize(null); document.body.classList.remove('pane-resizing'); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.classList.add('pane-resizing');
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('pane-resizing');
    };
  }, [paneResize]);
  const startPaneResize = (e) => {
    e.preventDefault();
    setPaneResize({ startX: e.clientX, startW: paneWidth });
  };
  return (
    <div className="view on" id="view-list">
      <div className="lpane" style={{ width: paneWidth }}>
      <div id="list" onScroll={(e) => { if (nearBottom(e.target)) fetchMore(); }}>
        {rows.map((r) => (
          <div className={`row${r.issue_key === selKey ? ' sel' : ''}`} key={r.id} onClick={() => onOpen(r.issue_key)}>
            <div className="top">
              <TypeIcon name={r.type_name} />
              <span className={`key${r.subtask ? ' sub' : ''}`}>{r.issue_key}</span>
              <span className="sum">{r.summary}</span>
            </div>
            <div className="meta">
              <span className={`badge cat-${r.status_category}`}>{r.status_name ?? '?'}</span>
              <Prio p={r.priority} />
              <span className="meta-type">{r.type_name ?? ''}</span>
              <span className="meta-spacer" />
              <Avatar name={r.assignee_name} />
              <span className="meta-date">{dt(r.updated_at)}</span>
            </div>
          </div>))}
      </div>
      <ListFoot total={total} shown={rows.length} loading={loading} onNew={onNew} onRefresh={onChanged} />
      </div>
      <div className="pane-resizer" title="드래그하여 이슈 목록 폭 조절" onMouseDown={startPaneResize} />
      <div id="detail">
        {selKey
          ? <IssueDetail issueKey={selKey} meta={meta} pdata={pdata} me={me} onOpen={onOpen} onChanged={onChanged} onTitle={onTitle} onSeen={onSeen} onNew={onNew} />
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
const GROUPERS = {
  status: (r) => r.status_name ?? '(없음)',
  assignee: (r) => r.assignee_name ?? '(미지정)',
  type: (r) => r.type_name ?? '(없음)',
  epic: (r) => r.epic_key ? `${r.epic_key} ${r.epic_summary ?? ''}` : '(에픽 없음)',
  priority: (r) => r.priority ?? '(없음)',
};

// 열 폭: 사용자가 머리글 경계를 드래그해 조절한다. 업무(요약) 열은 최소 폭을 크게 잡아
// 창이 좁아져도 내용이 잘리지 않고 표가 가로 스크롤되도록 한다.
const CHECKBOX_WIDTH = 40;
const SUMMARY_MIN = 480;
const DEFAULT_COL_WIDTHS = { key: 110, type: 106, assignee: 135, reporter: 135, priority: 100, status: 120, resolution: 80, created: 145, updated: 145 };
const MIN_COL_WIDTHS = { key: 70, type: 55, assignee: 80, reporter: 80, priority: 70, status: 80, resolution: 55, created: 95, updated: 95 };
const readLS = (key, fallback) => {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
};

export function TableView({ project, meta, filters, bump, onOpen, onChanged, onCount, onNew, boardJql }) {
  const [sort, setSort] = useState(null); // null이면 서버 기본(또는 JQL의 ORDER BY)을 따른다
  const [selected, setSelected] = useState(() => new Set());
  const [widths, setWidths] = useState(() => {
    const saved = readLS('jira.tableWidths.v3', {}) ?? {};
    // 예전 기본값(type=90)만 저장돼 있으면 아이콘이 들어갈 새 기본값으로 올린다
    if (saved.type === 90) saved.type = DEFAULT_COL_WIDTHS.type;
    return { ...DEFAULT_COL_WIDTHS, ...saved };
  });
  const [summaryWidth, setSummaryWidth] = useState(() => Math.max(SUMMARY_MIN, Number(readLS('jira.summaryWidth', SUMMARY_MIN)) || SUMMARY_MIN));
  const [summaryManual, setSummaryManual] = useState(() => readLS('jira.summaryManual', false) === true);
  const [resizing, setResizing] = useState(null);
  const wrapRef = useRef(null);
  const { rows, total, loading, fetchMore } = useIssues(project, filters, bump,
    { pageSize: 100, sort: sort ? (sort.dir < 0 ? '-' : '') + sort.field : null, extraJql: [boardJql] }); // 정렬은 서버에서 전체 기준으로
  useEffect(() => onCount(total), [total]);
  useEffect(() => { setSelected((cur) => new Set([...cur].filter((id) => rows.some((r) => r.id === id)))); }, [rows]);

  const fixedSum = CHECKBOX_WIDTH + TABLE_COLS
    .filter(([f]) => f !== 'summary')
    .reduce((sum, [f]) => sum + (widths[f] ?? DEFAULT_COL_WIDTHS[f]), 0);
  useEffect(() => { try { localStorage.setItem('jira.tableWidths.v3', JSON.stringify(widths)); } catch { /* 무시 */ } }, [widths]);
  useEffect(() => { try { localStorage.setItem('jira.summaryWidth', String(summaryWidth)); localStorage.setItem('jira.summaryManual', summaryManual ? 'true' : 'false'); } catch { /* 무시 */ } }, [summaryWidth, summaryManual]);
  // 업무 열은 창 폭에 맞춰 남는 공간을 차지한다. 사용자가 직접 조절한 뒤에는 그 폭을 유지한다.
  useEffect(() => {
    if (summaryManual) return;
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => setSummaryWidth(Math.max(SUMMARY_MIN, el.clientWidth - fixedSum));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fixedSum, summaryManual]);
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e) => {
      const delta = e.clientX - resizing.startX;
      if (resizing.field === 'summary') {
        setSummaryWidth(Math.max(SUMMARY_MIN, resizing.startW + delta));
        setSummaryManual(true);
      } else {
        setWidths((w) => ({ ...w, [resizing.field]: Math.max(MIN_COL_WIDTHS[resizing.field] ?? 50, resizing.startW + delta) }));
      }
    };
    const onUp = () => setResizing(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.classList.add('col-resizing');
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('col-resizing');
    };
  }, [resizing]);
  const startResize = (e, field) => {
    e.preventDefault(); e.stopPropagation();
    setResizing({ field, startX: e.clientX, startW: field === 'summary' ? summaryWidth : (widths[field] ?? DEFAULT_COL_WIDTHS[field]) });
  };
  const resetCol = (field) => {
    if (field === 'summary') setSummaryManual(false);
    else setWidths((w) => ({ ...w, [field]: DEFAULT_COL_WIDTHS[field] }));
  };

  const ordered = useMemo(() => {
    if (!filters.group) return rows;
    // 그룹화는 로드된 범위 안에서만 (스크롤로 더 불러오면 그룹이 늘어난다)
    const groups = new Map();
    for (const r of rows) {
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
  }, [rows, filters.group]);

  const clickSort = (f) => setSort((s) => s?.field === f ? { ...s, dir: -s.dir } : { field: f, dir: 1 });
  const changeStatus = async (r, id) => {
    await api('/api/issue/' + encodeURIComponent(r.issue_key), { method: 'PATCH', json: { statusId: id } });
    onChanged();
  };
  const toggle = (id) => setSelected((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(() => allOn ? new Set() : new Set(rows.map((r) => r.id)));

  return (
    <div className="view on" id="view-table">
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
    <div id="tablewrap" ref={wrapRef} onScroll={(e) => { if (nearBottom(e.target)) fetchMore(); }}>
      <table className="issues" style={{ width: fixedSum + summaryWidth, minWidth: '100%' }}>
        <colgroup>
          <col style={{ width: CHECKBOX_WIDTH }} />
          {TABLE_COLS.map(([f]) => <col key={f} style={{ width: f === 'summary' ? summaryWidth : widths[f] }} />)}
        </colgroup>
        <thead><tr>
          <th className="c-check"><input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="전체 선택" /></th>
          {TABLE_COLS.map(([f, label]) => (
            <th key={f} className={`c-${f}`} onClick={() => clickSort(f)}>{label}
              {sort?.field === f && <span className="arrow">{sort.dir > 0 ? '▲' : '▼'}</span>}
              <span className="col-resizer" title="드래그하여 열 폭 조절 (더블클릭: 초기화)"
                onMouseDown={(e) => startResize(e, f)} onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => { e.stopPropagation(); resetCol(f); }} /></th>))}
        </tr></thead>
        <tbody>{ordered.map((r, i) => r.__group !== undefined
          ? <tr className="ghead" key={'g' + i}><td colSpan={TABLE_COLS.length + 1}><span className="gtwisty">▾</span>{r.__group} <span className="dim">{r.__count}건</span></td></tr>
          : <tr key={r.id} className={selected.has(r.id) ? 'selected' : ''} onClick={() => onOpen(r.issue_key)}>
              <td className="c-check" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`${r.issue_key} 선택`} /></td>
              <td className="c-key"><span className="key-wrap"><TypeIcon name={r.type_name} /><span className={`ilink${r.status_category === 'done' ? ' done' : ''}`} onClick={() => onOpen(r.issue_key)}>{r.issue_key}</span></span></td>
              <td className="c-sum"><span className="cell-sum" onClick={() => onOpen(r.issue_key)}>{r.summary}</span></td>
              <td className="c-type"><span className="type-cell"><TypeIcon name={r.type_name} /><span>{r.type_name ?? ''}</span></span></td>
              <td className="c-assignee"><span className="person"><Avatar name={r.assignee_name} /><span>{r.assignee_name ?? ''}</span></span></td>
              <td className="c-reporter"><span className="person"><Avatar name={r.reporter_name} /><span>{r.reporter_name ?? ''}</span></span></td>
              <td className="c-priority"><span className="person"><Prio p={r.priority} /><span>{r.priority ?? ''}</span></span></td>
              <td className="c-status"><StatusSelect small statuses={meta.statuses} value={r.status_id} category={r.status_category}
                onChange={(id) => changeStatus(r, id)} /></td>
              <td className="c-resolution">{r.resolution ? <span className="resolved"><IconCheck size={14} />{r.resolution}</span> : (r.resolved_at ? <span className="resolved"><IconCheck size={14} />완료</span> : '')}</td>
              <td className="c-created">{dt(r.created_at)}</td>
              <td className="c-updated">{dt(r.updated_at)}</td>
            </tr>)}
        </tbody>
      </table>
    </div>
    <ListFoot total={total} shown={rows.length} loading={loading} onNew={onNew} onRefresh={onChanged} />
    </div></div>
  );
}


// ---------- 보드 (칸반) ----------
// Jira 보드 구조: 스윔레인(툴바의 '그룹화' — 에픽/담당자/우선순위/타입) × 컬럼.
// 레인마다 컬럼 칸이 각각 회색 블록(머리글 '상태 N')이고, 칸 아래 + 로 그 상태·레인에 바로 이슈를 만든다.
// 카드를 다른 칸으로 끌면 상태를, 다른 레인으로 끌면 그 레인의 값(에픽·담당자·우선순위)도 바꾼다.
const LANE_MODES = ['epic', 'assignee', 'priority', 'type'];
const NO_LANE = '__none__';
const DEFAULT_COLS = [['new', '해야 할 일'], ['indeterminate', '진행 중'], ['done', '완료']];
const NO_LANE_LABEL = { epic: '에픽 없음', assignee: '미지정', priority: '우선순위 없음', type: '타입 없음' };

export function BoardView({ project, meta, pdata, filters, bump, onOpen, onChanged, onCount, reloadPdata, boardId, onBoard }) {
  const board = pdata.boards.find((b) => String(b.id) === boardId);
  // 보드 필터(JQL) + 스크럼 보드는 활성 스프린트만 (실제 Jira 스크럼 보드 동작)
  const extraJql = board ? [board.jql, board.type === 'scrum' ? 'sprint IN activeSprints()' : null].filter(Boolean) : [];
  const { rows, total } = useIssues(project, filters, bump, { extraJql }); // 보드는 최신 1,000건 (가상 스크롤 대상 아님)
  const [modal, setModal] = useState(null); // null | {board or undefined}
  const [dragKey, setDragKey] = useState(null);
  const [over, setOver] = useState(null);       // 'lane|col'
  const [creating, setCreating] = useState(null); // 'lane|col'
  const [collapsed, setCollapsed] = useState(() => new Set());
  useEffect(() => onCount(total), [total]);
  // 보드 목록이 로드된 뒤에만 유효성 검사 (로드 전 빈 배열로 ?b= 딥링크를 지우지 않도록)
  useEffect(() => { if (boardId && pdata.boards.length && !pdata.boards.some((b) => String(b.id) === boardId)) onBoard(''); }, [pdata.boards]);
  // 기본 보드: 새 Jira 프로젝트 보드처럼 상태 범주 3컬럼(해야 할 일·진행 중·완료).
  // 칸으로 끌어놓거나 + 로 만들면 범주 이름과 같은 상태(없으면 범주의 첫 상태)가 된다.
  const cols = board
    ? board.columns.map((c) => ({ name: c.name, statusIds: c.statusIds.map(Number), custom: true }))
    : DEFAULT_COLS.map(([cat, name]) => {
      const ids = meta.statuses.filter((s) => s.category === cat).map((s) => Number(s.id));
      const main = meta.statuses.find((s) => s.category === cat && s.name === name);
      return { name, category: cat, statusIds: main ? [Number(main.id), ...ids.filter((x) => x !== Number(main.id))] : ids };
    }).filter((c) => c.statusIds.length);
  const colOf = new Map();
  cols.forEach((c, i) => c.statusIds.forEach((s) => colOf.set(s, i)));
  const statusName = (id) => meta.statuses.find((s) => Number(s.id) === id)?.name ?? id;
  // 스크럼 보드: 활성 스프린트(여럿이면 선택). + 로 만든 이슈는 선택된(또는 첫) 활성 스프린트에 들어간다
  const activeSprints = board?.type === 'scrum' ? pdata.sprints.filter((s) => s.state === 'active') : [];
  const [sprintSel, setSprintSel] = useState('');
  useEffect(() => { if (sprintSel && !activeSprints.some((s) => String(s.id) === sprintSel)) setSprintSel(''); }, [pdata.sprints, boardId]);
  const shownSprints = sprintSel ? activeSprints.filter((s) => String(s.id) === sprintSel) : activeSprints;
  const activeSprint = shownSprints[0] ?? null;

  // ---- 레인 구성 ----
  const laneMode = LANE_MODES.includes(filters.group) ? filters.group : '';
  const epicIssues = new Map(); // 에픽 레인: 에픽 자신은 카드가 아니라 레인 머리글
  const cards = [];
  for (const r of rows) {
    if (sprintSel && String(r.sprint_id) !== sprintSel) continue;
    if (laneMode === 'epic' && r.type_name === '에픽') epicIssues.set(String(r.id), r);
    else cards.push(r);
  }
  const laneKeyOf = (r) => {
    if (laneMode === 'epic') return r.epic_id ? String(r.epic_id) : NO_LANE;
    if (laneMode === 'assignee') return r.assignee_id ? String(r.assignee_id) : NO_LANE;
    if (laneMode === 'priority') return r.priority || NO_LANE;
    if (laneMode === 'type') return r.type_name || NO_LANE;
    return NO_LANE;
  };
  const lanes = new Map();
  let hidden = 0;
  for (const r of cards) {
    const ci = colOf.get(Number(r.status_id));
    if (ci == null) { hidden++; continue; }
    const k = laneKeyOf(r);
    if (!lanes.has(k)) lanes.set(k, { key: k, sample: r, buckets: cols.map(() => []), count: 0 });
    const l = lanes.get(k);
    l.buckets[ci].push(r); l.count++;
  }
  if (!lanes.size) lanes.set(NO_LANE, { key: NO_LANE, sample: null, buckets: cols.map(() => []), count: 0 });
  const keyNum = (k) => Number(String(k ?? '').split('-')[1]) || 0;
  const laneSort = (a, b) => {
    if (a.key === NO_LANE) return 1;
    if (b.key === NO_LANE) return -1;
    if (laneMode === 'epic') return keyNum(a.sample.epic_key) - keyNum(b.sample.epic_key);
    if (laneMode === 'priority') return (PRIORITY_ORDER[a.key] ?? 9) - (PRIORITY_ORDER[b.key] ?? 9);
    const name = (l) => (laneMode === 'assignee' ? l.sample.assignee_name : l.key) ?? '';
    return name(a).localeCompare(name(b), 'ko');
  };
  const laneList = [...lanes.values()].sort(laneSort);

  // 레인 값 → 이슈 필드 (만들기·끌어놓기 공용)
  const laneFields = (lane) => {
    if (laneMode === 'epic') return { parentKey: lane.key === NO_LANE ? '' : lane.sample.epic_key };
    if (laneMode === 'assignee') return { assigneeId: lane.key === NO_LANE ? null : Number(lane.key) };
    if (laneMode === 'priority') return { priority: lane.key === NO_LANE ? null : lane.key };
    return {};
  };

  const drop = async (lane, colIdx) => {
    setOver(null);
    if (!dragKey) return;
    const r = cards.find((x) => x.issue_key === dragKey);
    if (!r) return;
    const c = cols[colIdx];
    const json = {};
    if (!c.statusIds.includes(Number(r.status_id))) json.statusId = c.statusIds[0];
    if (laneKeyOf(r) !== lane.key) {
      if (laneMode === 'type') return alert('타입이 다른 레인으로는 옮길 수 없습니다 — 이슈 상세에서 타입을 바꾸세요');
      if (laneMode === 'epic' && r.epic_id && String(r.parent_id) !== String(r.epic_id)) {
        return alert('하위 작업은 상위 이슈를 따라가므로 다른 에픽으로 옮길 수 없습니다');
      }
      Object.assign(json, laneFields(lane));
    }
    if (!Object.keys(json).length) return;
    await api('/api/issue/' + encodeURIComponent(dragKey), { method: 'PATCH', json });
    onChanged();
  };
  const delBoard = async () => {
    if (!board) return alert('삭제할 보드를 선택하세요');
    if (!confirm(`보드 '${board.name}'을(를) 삭제할까요? (이슈는 삭제되지 않습니다)`)) return;
    await api('/api/boards/' + board.id, { method: 'DELETE' });
    onBoard(''); reloadPdata();
  };
  const toggleLane = (k) => setCollapsed((cur) => { const n = new Set(cur); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const laneHead = (lane) => {
    const r = lane.sample;
    if (lane.key === NO_LANE) return <span className="lane-title">{NO_LANE_LABEL[laneMode]}</span>;
    if (laneMode === 'epic') {
      const ep = epicIssues.get(lane.key);
      return <>
        <span className="lane-sq" style={{ background: hashColor(r.epic_id) }} />
        <span className="lane-key ilink" onClick={(e) => { e.stopPropagation(); onOpen(r.epic_key); }}>{r.epic_key}</span>
        <span className="lane-title">{r.epic_summary}</span>
        {ep && <span className={`badge cat-${ep.status_category}`}>{ep.status_name}</span>}
        {ep?.assignee_name && <Avatar name={ep.assignee_name} />}
      </>;
    }
    if (laneMode === 'assignee') return <><Avatar name={r.assignee_name} /><span className="lane-title">{r.assignee_name}</span></>;
    if (laneMode === 'priority') return <><Prio p={r.priority} /><span className="lane-title">{r.priority}</span></>;
    return <><TypeIcon name={r.type_name} /><span className="lane-title">{r.type_name}</span></>;
  };

  return (
    <div className="view on" id="view-board">
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <div className="bbar">
          <select value={boardId} onChange={(e) => onBoard(e.target.value)}>
            <option value="">기본 (해야 할 일·진행 중·완료)</option>
            {pdata.boards.map((b) => <option key={b.id} value={b.id}>{b.name}{b.type === 'scrum' ? ' (스크럼)' : ''}</option>)}
          </select>
          {board?.type === 'scrum' && <span className="badge cat-indeterminate" title="스크럼 보드는 활성 스프린트 이슈만 표시합니다">활성 스프린트</span>}
          {board?.type === 'scrum' && !activeSprints.length &&
            <span className="dim">활성 스프린트가 없어 비어 있습니다 — 백로그에서 스프린트를 시작하세요</span>}
          {activeSprints.length > 1 && (
            <select value={sprintSel} onChange={(e) => setSprintSel(e.target.value)} title="활성 스프린트가 여러 개입니다">
              <option value="">스프린트: 전체 ({activeSprints.length})</option>
              {activeSprints.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
            </select>
          )}
          {board?.jql && <span className="dim" title={board.jql} style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>필터: {board.jql}</span>}
          <button onClick={() => setModal({})}>+ 보드 만들기</button>
          <button onClick={() => board ? setModal({ board }) : alert('편집할 보드를 선택하세요 (기본 보드는 편집 불가)')}>편집</button>
          <button onClick={delBoard}>삭제</button>
          <span className="dim">{hidden ? `컬럼에 없는 상태의 이슈 ${hidden}건 숨김` : ''}</span>
        </div>
        <div id="board">
          {shownSprints.map((sp) => (
            <SprintBar key={sp.id} sprint={sp} rows={rows.filter((r) => String(r.sprint_id) === String(sp.id))}
              onComplete={async (msg) => {
                if (!confirm(msg)) return;
                await api('/api/sprints/' + sp.id, { method: 'PATCH', json: { state: 'closed' } });
                await reloadPdata(); onChanged();
              }} />
          ))}
          {laneList.map((lane) => {
            const shut = collapsed.has(lane.key);
            return (
              <section className="lane" key={lane.key}>
                {laneMode && (
                  <div className="lane-head" onClick={() => toggleLane(lane.key)}>
                    <span className="lane-twisty">{shut ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}</span>
                    {laneHead(lane)}
                    <span className="lane-count">{lane.count}</span>
                  </div>
                )}
                {!shut && (
                  <div className="lane-cols">
                    {cols.map((c, i) => {
                      const cell = `${lane.key}|${i}`;
                      return (
                        <div className={`bcell${over === cell ? ' dragover' : ''}`} key={i} title={c.statusIds.map(statusName).join(', ')}
                          onDragOver={(e) => { e.preventDefault(); setOver(cell); }}
                          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null); }}
                          onDrop={(e) => { e.preventDefault(); drop(lane, i); }}>
                          <div className="bcell-head"><span>{c.name}</span><span className="bcell-n">{lane.buckets[i].length}</span></div>
                          <div className="cards">
                            {lane.buckets[i].map((r) => (
                              <BoardCard key={r.id} r={r} dragging={dragKey === r.issue_key} onOpen={onOpen}
                                onDragStart={() => setDragKey(r.issue_key)} onDragEnd={() => { setDragKey(null); setOver(null); }} />
                            ))}
                          </div>
                          {creating === cell
                            ? <CellCreate meta={meta} noEpic={laneMode === 'epic'}
                                presetType={laneMode === 'type' && lane.key !== NO_LANE ? lane.key : null}
                                onCancel={() => setCreating(null)}
                                onCreate={async (typeId, summary) => {
                                  await api('/api/issues', { method: 'POST', json: {
                                    projectKey: project, typeId: Number(typeId), summary, statusId: c.statusIds[0],
                                    sprintId: activeSprint?.id ?? null, ...laneFields(lane),
                                  } });
                                  onChanged(); // 입력 칸은 열어 둔다 (연속 입력)
                                }} />
                            : <button className="bcell-add" title={`${c.name}에 이슈 만들기`} onClick={() => setCreating(cell)}>+</button>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
      {modal && <BoardModal meta={meta} project={project} board={modal.board}
        onClose={() => setModal(null)}
        onSaved={(b) => { setModal(null); reloadPdata().then(() => onBoard(String(b.id))); }} />}
    </div>
  );
}

// 스크럼 보드 머리: 스프린트 이름·기간·남은 일수·목표 + 스프린트 완료
const md = (d) => new Date(d).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
function SprintBar({ sprint, rows, onComplete }) {
  const done = rows.filter((r) => r.status_category === 'done').length;
  const open = rows.length - done;
  const left = sprint.end_at ? Math.ceil((new Date(sprint.end_at) - Date.now()) / 86400000) : null;
  return (
    <div className="sprintbar">
      <div className="sprintbar-main">
        <b>{sprint.name}</b>
        {(sprint.start_at || sprint.end_at) && (
          <span className="dim">{sprint.start_at ? md(sprint.start_at) : '?'} ~ {sprint.end_at ? md(sprint.end_at) : '?'}</span>
        )}
        {left != null && (
          <span className={`badge ${left < 0 ? 'cat-overdue' : 'cat-indeterminate'}`}>
            {left < 0 ? `기한 ${-left}일 지남` : left === 0 ? '오늘 종료' : `${left}일 남음`}
          </span>
        )}
        <span className="dim">완료 {done} · 미완료 {open}</span>
        <span style={{ flex: 1 }} />
        <button onClick={() => onComplete(
          `스프린트 '${sprint.name}'을(를) 완료할까요?\n완료된 이슈 ${done}건은 스프린트에 남고, 미완료 ${open}건은 백로그로 돌아갑니다.`)}>
          스프린트 완료</button>
      </div>
      {sprint.goal && <div className="sprintbar-goal">목표: {sprint.goal}</div>}
    </div>
  );
}

// 보드 카드: 제목 / 에픽·버전·레이블 칩 / 타입·키 + 우선순위·담당자
function BoardCard({ r, dragging, onOpen, onDragStart, onDragEnd }) {
  return (
    <div className={`card${dragging ? ' dragging' : ''}`} draggable onDragStart={onDragStart} onDragEnd={onDragEnd}
      onClick={() => onOpen(r.issue_key)}>
      <div className="sum">{r.summary}</div>
      {(r.epic_id || (r.fix_versions ?? []).length > 0 || (r.labels ?? []).length > 0) && (
        <div className="labels">
          {r.epic_id && <span className="epic-chip" title={`${r.epic_key} ${r.epic_summary ?? ''}`}>
            <span className="lane-sq" style={{ background: hashColor(r.epic_id) }} />{r.epic_summary ?? r.epic_key}</span>}
          {(r.fix_versions ?? []).map((v) => <span className="chip chip-ver" key={'v' + v}>{v}</span>)}
          {(r.labels ?? []).map((l) => <span className="chip" key={l}>{l}</span>)}
        </div>
      )}
      <div className="meta">
        <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
          <TypeIcon name={r.type_name} />
          <span className={`ilink${r.status_category === 'done' ? ' done' : ''}`}>{r.issue_key}</span>
        </span>
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Prio p={r.priority} /><Avatar name={r.assignee_name} /></span>
      </div>
    </div>
  );
}

// 칸 아래 + → 인라인 이슈 만들기 (Enter 만들기·계속 입력, Esc 닫기)
function CellCreate({ meta, noEpic, presetType, onCreate, onCancel }) {
  const types = meta.types.filter((t) => !t.subtask && !(noEpic && t.name === '에픽'));
  const preset = presetType && types.find((t) => t.name === presetType);
  const [typeId, setTypeId] = useState(() => (preset ?? types.find((t) => /작업|task/i.test(t.name)) ?? types[0])?.id);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const s = text.trim(); if (!s || busy) return;
    setBusy(true);
    try { await onCreate(typeId, s); setText(''); } finally { setBusy(false); }
  };
  return (
    <div className="cell-create" onClick={(e) => e.stopPropagation()}>
      <textarea autoFocus rows={2} placeholder="무엇을 완료해야 합니까?" value={text} disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          else if (e.key === 'Escape') onCancel();
        }} />
      <div className="cell-create-row">
        <select value={typeId} onChange={(e) => setTypeId(e.target.value)} disabled={!!preset}>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        <button onClick={onCancel}>취소</button>
        <button className="primary" onClick={submit} disabled={busy || !text.trim()}>만들기</button>
      </div>
    </div>
  );
}

// 완료 스프린트 한 개: 펼칠 때 이슈를 지연 로드, 행은 읽기 전용 (보관 성격)
function ClosedSprint({ project, s, onOpen }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(null);
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && list === null) {
      const qs = new URLSearchParams({ project, sprint: s.id, limit: 1000, offset: 0 });
      setList((await api('/api/issues?' + qs)).rows);
    }
  };
  return (
    <div className="csprint">
      <div className="cshead" onClick={toggle}>
        <span className="dim" style={{ width: 14 }}>{open ? '▾' : '▸'}</span>
        <b>{s.name}</b>
        <span className="badge cat-done">완료</span>
        <span className="goal">{s.goal ?? ''}{s.end_at ? ` · ${dt(s.end_at)} 종료` : ''}</span>
        {list !== null && <><span className="dim">{list.length}건</span><CatChips rows={list} /></>}
      </div>
      {open && (list === null
        ? <div className="sempty">불러오는 중…</div>
        : !list.length
          ? <div className="sempty">이슈 없음</div>
          : list.map((r) => (
            <div className="srow" key={r.id}>
              <EpicBar r={r} />
              <TypeIcon name={r.type_name} />
              <span className={`key ilink${r.status_category === 'done' ? ' done' : ''}`} onClick={() => onOpen(r.issue_key)}>{r.issue_key}</span>
              <span className="sum">{r.summary}</span>
              <span className={`badge cat-${r.status_category}`}>{r.status_name ?? '?'}</span>
              <Prio p={r.priority} />
              <Avatar name={r.assignee_name} />
            </div>)))}
    </div>
  );
}

// 스프린트/백로그 섹션 하단 인라인 이슈 만들기 (Jira 백로그의 '+ 만들기')
function QuickCreate({ meta, project, sprintId, open, onToggle, onCreated }) {
  const [text, setText] = useState('');
  const types = meta.types.filter((t) => !t.subtask);
  const [typeId, setTypeId] = useState(() => (types.find((t) => /작업|task/i.test(t.name)) ?? types[0])?.id);
  const create = async () => {
    const s = text.trim(); if (!s) return;
    await api('/api/issues', { method: 'POST', json: { projectKey: project, typeId: Number(typeId), summary: s, description: '', sprintId } });
    setText('');
    onCreated(); // 목록 재조회 — 입력 폼은 열린 채 유지 (Jira처럼 연속 입력)
  };
  if (!open) return <button className="plain screate" onClick={() => onToggle(true)}>+ 만들기</button>;
  return (
    <div className="screate-row">
      <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
        {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <input autoFocus placeholder="무엇을 완료해야 합니까?" value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') create(); else if (e.key === 'Escape') { setText(''); onToggle(false); } }} />
      <button className="primary" onClick={create}>만들기</button>
      <button onClick={() => { setText(''); onToggle(false); }}>취소</button>
    </div>
  );
}

// ---------- 백로그 (스프린트 + 인라인 계층) ----------
export function BacklogView({ project, meta, pdata, filters, bump, onOpen, onChanged, onCount, reloadPdata, boardJql, board }) {
  // 사용자 JQL은 백로그에 적용하지 않지만(실제 Jira 백로그도 JQL 미지원), 보드 컨텍스트 필터는 적용한다.
  // 두 번 나눠 로드: ① 열린 스프린트 소속 이슈는 전부 ② 백로그(스프린트 없음)는 최신순 1,000건
  //   — 보드 필터의 ORDER BY가 로드 윈도우를 바꿔 스프린트 이슈가 빠지는 문제 방지 (완료 스프린트는 아래 접힘 그룹에서 지연 로드)
  // 실제 Jira 백로그처럼 완료(done) 이슈는 어디에도 표시하지 않는다 (완료분은 보드/목록·완료 스프린트 그룹에서)
  const { rows: sprRows } = useIssues(project, { ...filters, sprint: '', jql: '' }, bump,
    { extraJql: [boardJql, 'sprint IN openSprints()', 'statusCategory != done'] });
  const { rows: backRows, total: backTotal } = useIssues(project, { ...filters, sprint: 'none', jql: '' }, bump,
    { extraJql: [boardJql, 'statusCategory != done'], sort: '-key' });
  const [expanded, setExpanded] = useState(() => new Set());
  const [showClosed, setShowClosed] = useState(false);
  const [qc, setQc] = useState(() => new Set()); // 인라인 '+ 만들기'가 열린 섹션 (스프린트 id | 'none')
  const toggleQc = (k, v) => setQc((prev) => { const n = new Set(prev); v ? n.add(k) : n.delete(k); return n; });
  const countItems = (rows) => rows.filter((r) => !r.subtask).length;
  useEffect(() => onCount(countItems(sprRows) + countItems(backRows)), [sprRows, backRows]);

  // 요약 칩 분류: 보드 컨텍스트가 있으면 실제 Jira처럼 보드 컬럼 위치 기준(첫 컬럼=회색, 마지막=초록, 중간=파랑),
  // 없으면 상태 카테고리 기준
  const colGroup = {};
  if (board?.columns?.length > 1) {
    board.columns.forEach((c, i) => {
      const g = i === 0 ? 'new' : i === board.columns.length - 1 ? 'done' : 'indeterminate';
      for (const sid of c.statusIds ?? []) colGroup[String(sid)] = g;
    });
  }
  const chipCat = (r) => colGroup[String(r.status_id)] ?? r.status_category;

  const bySprint = new Map();
  for (const r of [...sprRows, ...backRows]) {
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
      <TypeIcon name={r.type_name} />
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

  // Jira 백로그처럼 하위 작업은 카드로 세지 않는다 — 부모 행의 ▸로만 펼쳐 보이고,
  // 부모가 이 화면에 없는 하위 작업은 표시하지 않는다 (헤더 건수·칩·카드 수가 모두 같은 기준이 된다)
  const sectionRows = (list) => {
    const childrenOf = new Map();
    for (const r of list) {
      if (r.subtask && r.parent_id) {
        if (!childrenOf.has(r.parent_id)) childrenOf.set(r.parent_id, []);
        childrenOf.get(r.parent_id).push(r);
      }
    }
    return list.filter((r) => !r.subtask).map((r) => {
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
    const items = list.filter((r) => !r.subtask); // 헤더 건수·칩·카드 모두 같은 기준(하위 작업 제외)
    return (
      <div className="sprint">
        <div className="shead">
          <b>{s.name}</b>
          <span className={`badge ${s.state === 'active' ? 'cat-indeterminate' : s.state === 'closed' ? 'cat-done' : 'cat-new'}`}>
            {{ future: '예정', active: '활성', closed: '완료' }[s.state]}</span>
          <span className="goal">
            {s.start_at ? `${dt(s.start_at)} ~ ${s.end_at ? dt(s.end_at) : ''} ` : ''}
            ({items.length}개의 업무 항목){s.goal ? ` · ${s.goal}` : ''}
          </span>
          <CatChips rows={items} catOf={chipCat} />
          {s.state === 'future' && <button onClick={() => sprintState(s.id, 'active')}>스프린트 시작</button>}
          {s.state === 'active' && <button onClick={() => sprintState(s.id, 'closed', '스프린트를 완료할까요? 미완료 이슈는 백로그로 돌아갑니다.')}>스프린트 완료</button>}
        </div>
        {items.length ? sectionRows(list) : <div className="sempty">이슈 없음 — 아래 백로그에서 이동하세요</div>}
        <QuickCreate meta={meta} project={project} sprintId={s.id}
          open={qc.has(s.id)} onToggle={(v) => toggleQc(s.id, v)} onCreated={onChanged} />
      </div>
    );
  };

  const backlogList = bySprint.get('none') ?? [];
  const backItems = backlogList.filter((r) => !r.subtask);
  const closedSprints = pdata.sprints.filter((s) => s.state === 'closed')
    .sort((a, b) => new Date(b.end_at ?? b.start_at ?? 0) - new Date(a.end_at ?? a.start_at ?? 0)); // 최근 완료 먼저
  return (
    <div className="view on" id="view-backlog"><div id="backlog">
      <div style={{ marginBottom: 12 }}><button className="primary" onClick={newSprint}>+ 스프린트 만들기</button></div>
      {pdata.sprints.filter((s) => s.state === 'active').map((s) => <SprintBlock s={s} key={s.id} />)}
      {pdata.sprints.filter((s) => s.state === 'future').map((s) => <SprintBlock s={s} key={s.id} />)}
      <div className="sprint">
        <div className="shead"><b>백로그</b>
          <span className="goal">({backItems.length.toLocaleString()}개의 업무 항목{backlogList.length < backTotal ? ` — 최신 ${backlogList.length.toLocaleString()}건 로드 기준` : ''})</span>
          <CatChips rows={backItems} catOf={chipCat} /></div>
        {backItems.length ? sectionRows(backlogList) : <div className="sempty">백로그가 비어 있습니다</div>}
        <QuickCreate meta={meta} project={project} sprintId={null}
          open={qc.has('none')} onToggle={(v) => toggleQc('none', v)} onCreated={onChanged} />
      </div>
      {closedSprints.length > 0 && (
        <div className="sprint">
          <div className="shead" style={{ cursor: 'pointer' }} onClick={() => setShowClosed((v) => !v)}>
            <span className="dim" style={{ width: 14 }}>{showClosed ? '▾' : '▸'}</span>
            <b>완료된 스프린트</b>
            <span className="dim">{closedSprints.length}개 — 펼쳐서 확인 (이슈는 펼칠 때 로드)</span>
          </div>
          {showClosed && closedSprints.map((s) => <ClosedSprint project={project} s={s} onOpen={onOpen} key={s.id} />)}
        </div>
      )}
    </div></div>
  );
}
