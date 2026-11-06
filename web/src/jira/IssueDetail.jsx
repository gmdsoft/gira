import { useMobile, isMobile } from '../mobile.js';
// 이슈 상세: Jira식 2단 (본문 가변 + 우측 고정 패널), 하위 작업 패널, 인라인 필드 변경, 편집 모드
import React, { useEffect, useRef, useState } from 'react';
import { api, dt, fileSize, Prio, Avatar, StatusSelect, PRIORITY_ORDER } from './util.jsx';
import { TypeIcon } from './icons.jsx';
import { IconChevronDown, IconChevronRight, IconPlus, IconShare, IconLock, IconEye, IconCheck } from './icons.jsx';
import AdfView from './adf.jsx';
import { AddMenu, SubtaskInline, LinkInline, WebLinkInline, linkPhrase } from './IssueAdd.jsx';
import CommentComposer from '../comment-composer.jsx';
import DescEditor from './DescEditor.jsx';
import { tiptapToAdf, hasRichContent, adfPlain } from './adf-convert.js';

// 클릭하면 제자리에서 입력으로 바뀌는 한 줄 텍스트 (Enter 저장, Esc 취소)
function InlineText({ value, onSave, as: Tag = 'span', className, placeholder, inputStyle }) {
  const mobile = useMobile();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value ?? '');
  useEffect(() => setVal(value ?? ''), [value]);
  if (mobile) return <Tag className={className}>{value || placeholder}</Tag>;
  if (!editing) {
    return <Tag className={`${className ?? ''} inline-edit`} title="클릭하여 편집" onClick={() => setEditing(true)}>
      {value || <span className="dim">{placeholder}</span>}</Tag>;
  }
  const done = (save) => {
    setEditing(false);
    if (save && val.trim() !== (value ?? '')) onSave(val);
    else setVal(value ?? '');
  };
  return <input autoFocus value={val} style={{ width: '100%', ...inputStyle }}
    onChange={(e) => setVal(e.target.value)}
    onBlur={() => done(true)}
    onKeyDown={(e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); }} />;
}

// ---------- 필드 컨트롤 (Jira식 팝오버/칩) ----------
function Popover({ children, onClose, width }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return <div className="popover" ref={ref} style={width ? { width } : undefined}>{children}</div>;
}

function SelectPicker({ display, items, value, onSelect, searchable = false, placeholder = '검색', width = 300 }) {
  const mobile = useMobile();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const close = () => { setOpen(false); setQ(''); };
  const filtered = items.filter((it) => !q || it.label.toLowerCase().includes(q.toLowerCase()));
  if (mobile) return <span className="field-display">{display}</span>;
  return (
    <span className="field-picker">
      <button type="button" className="field-display" onClick={() => setOpen((v) => !v)}>
        {display}<IconChevronDown size={12} />
      </button>
      {open && <Popover onClose={close} width={width}>
        {searchable && <input autoFocus className="picker-search" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />}
        <div className="picker-list">
          {filtered.map((it) => (
            <button type="button" key={String(it.value)} className={`picker-item${String(it.value) === String(value) ? ' on' : ''}`}
              onClick={() => { onSelect(it.value); close(); }}>
              {it.node ?? it.label}
              {String(it.value) === String(value) && <IconCheck size={14} className="picker-check" />}
            </button>))}
          {!filtered.length && <div className="picker-empty">항목이 없습니다</div>}
        </div>
      </Popover>}
    </span>
  );
}

function MultiPicker({ values = [], options = [], emptyLabel, addLabel, searchPlaceholder, onChange, width = 320 }) {
  const mobile = useMobile();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const close = () => { setOpen(false); setQ(''); };
  const available = options.filter((o) => !values.includes(o) && (!q || o.toLowerCase().includes(q.toLowerCase())));
  if (mobile) return <span>{values.join(', ') || '-'}</span>;
  return (
    <span className="field-picker">
      {values.map((v) => (
        <span className="field-chip" key={v}>{v}
          <button type="button" className="chip-x" title="제거" onClick={() => onChange(values.filter((x) => x !== v))}>×</button>
        </span>))}
      <button type="button" className="add-link" onClick={() => setOpen((v) => !v)}>{values.length ? addLabel : emptyLabel}</button>
      {open && <Popover onClose={close} width={width}>
        <input autoFocus className="picker-search" placeholder={searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="picker-list">
          {available.map((o) => <button type="button" className="picker-item" key={o} onClick={() => { onChange([...values, o]); setQ(''); }}>{o}</button>)}
          {!available.length && <div className="picker-empty">{q ? '검색 결과가 없습니다' : '추가할 항목이 없습니다'}</div>}
        </div>
      </Popover>}
    </span>
  );
}

function ParentPicker({ project, issueKey, parentKey, parentSummary, onPick, onOpen }) {
  const mobile = useMobile();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const close = () => { setOpen(false); setQ(''); };
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const d = await api(`/api/issues?project=${encodeURIComponent(project)}&q=${encodeURIComponent(q)}&limit=20`);
        if (alive) setRows((d.rows ?? []).filter((r) => r.issue_key !== issueKey));
      } finally {
        if (alive) setLoading(false);
      }
    }, 180);
    return () => { alive = false; clearTimeout(t); };
  }, [open, q, project, issueKey]);
  if (mobile) return <span className="ilink" onClick={() => parentKey && onOpen(parentKey)}>{parentKey || '-'} {parentSummary}</span>;
  return (
    <span className="field-picker">
      {parentKey && <span className="field-chip parent-chip">
        <span className="ilink" onClick={() => onOpen(parentKey)}>{parentKey}</span>
        <span className="parent-sum" title={parentSummary ?? ''}>{parentSummary ?? ''}</span>
        <button type="button" className="chip-x" title="상위 항목 해제" onClick={() => onPick('')}>×</button>
      </span>}
      <button type="button" className="add-link" onClick={() => setOpen((v) => !v)}>{parentKey ? '변경' : '상위 항목 추가'}</button>
      {open && <Popover onClose={close} width={420}>
        <input autoFocus className="picker-search" placeholder="이슈 키 또는 요약 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="picker-list">
          {loading ? <div className="picker-empty">검색 중…</div> : rows.map((r) => (
            <button type="button" className="picker-item parent-pick" key={r.issue_key}
              onClick={() => { onPick(r.issue_key); close(); }}>
              <span className="pk">{r.issue_key}</span>
              <span className="ps" title={r.summary}>{r.summary}</span>
              <span className={`badge cat-${r.status_category}`}>{r.status_name ?? '?'}</span>
            </button>))}
          {!loading && !rows.length && <div className="picker-empty">이슈가 없습니다</div>}
        </div>
      </Popover>}
    </span>
  );
}

const relTime = (s) => {
  if (!s) return '';
  const diff = Date.now() - new Date(s).getTime();
  const min = 60000, hour = 60 * min, day = 24 * hour, month = 30 * day, year = 365 * day;
  if (diff < min) return '방금 전';
  if (diff < hour) return `${Math.floor(diff / min)}분 전`;
  if (diff < day) return `${Math.floor(diff / hour)}시간 전`;
  if (diff < month) return `${Math.floor(diff / day)}일 전`;
  if (diff < year) return `${Math.floor(diff / month)}개월 전`;
  return `${Math.floor(diff / year)}년 전`;
};
const statusCategoryOf = (name) => {
  if (!name || name === '없음') return null;
  if (/done|complete|closed|resolved|배포|완료|닫음/i.test(name)) return 'done';
  if (/progress|review|진행|검토/i.test(name)) return 'indeterminate';
  return 'new';
};
const HISTORY_ACTION = {
  status: '상태 변경됨', assignee: '담당자 변경됨', reporter: '보고자 변경됨',
  priority: '우선 순위 업데이트됨', summary: '요약 업데이트됨', description: '설명 업데이트됨',
  issuetype: '업무 유형 변경됨', labels: '레이블 업데이트됨', components: '컴포넌트 업데이트됨',
  Component: '컴포넌트 업데이트됨', fixVersions: '수정 버전 업데이트됨', 'Fix Version': '수정 버전 업데이트됨',
  resolution: '해결 상태 업데이트됨', Sprint: '스프린트 업데이트됨', Parent: '상위 항목 업데이트됨',
  Attachment: '첨부 파일 추가됨', issuelinks: '연결된 이슈 업데이트됨', Link: '연결된 이슈 업데이트됨',
  security: '보안 등급 업데이트됨', duedate: '기한 업데이트됨', Rank: '순위 업데이트됨',
  created: '업무 항목 생성함', environment: '환경 업데이트됨',
  timeestimate: '시간 추적 업데이트됨', timespent: '시간 추적 업데이트됨',
};

export default function IssueDetail({ issueKey, meta, pdata, me, onOpen, onChanged, onTitle, onSeen, onNew, onHome }) {
  const mobile = useMobile();
  const [d, setD] = useState(null);
  const [descEditing, setDescEditing] = useState(false);
  const [editingComment, setEditingComment] = useState(null); // {id, text}
  const [actTab, setActTab] = useState('comments'); // all | comments | history | worklog
  const fileRef = useRef(null);
  const descEditorRef = useRef(null);
  const [adding, setAdding] = useState(null); // '+' 메뉴로 연 입력 줄: 'subtask' | 'link' | 'weblink'
  const secRef = { subtask: useRef(null), link: useRef(null), weblink: useRef(null), attach: useRef(null) };
  const openAdd = (kind) => {
    if (kind === 'attach') { fileRef.current?.click(); return; }
    setAdding(kind);
    setTimeout(() => secRef[kind]?.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30);
  };
  // 단축키 (Jira와 같게): ⇧C 하위 작업 만들기, ⇧K 업무 항목 연결 — 입력 중이 아닐 때만
  useEffect(() => {
    const onKey = (e) => {
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (e.code === 'KeyC' && d && !d.subtask) { e.preventDefault(); openAdd('subtask'); }
      else if (e.code === 'KeyK' && d) { e.preventDefault(); openAdd('link'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const load = async () => {
    const data = await api('/api/issue/' + encodeURIComponent(issueKey));
    setD(data);
    onTitle?.(`[${data.issue_key}] ${data.summary} - Gira`);
    onSeen?.(data.issue_key, data.summary);
  };
  useEffect(() => { setDescEditing(false); setEditingComment(null); setAdding(null); load(); }, [issueKey]);

  useEffect(() => { if (mobile) { setDescEditing(false); setEditingComment(null); } }, [mobile]);

  if (!d) return <div className="placeholder">불러오는 중…</div>;

  const patch = async (json, reload = true) => {
    if (isMobile()) return;
    await api('/api/issue/' + encodeURIComponent(issueKey), { method: 'PATCH', json });
    if (reload) { load(); onChanged?.(); }
  };
  // 댓글 첨부: 이슈 첨부로 올리고, 댓글에는 그 첨부 id를 넘긴다
  const uploadFile = async (file) => {
    const fd = new FormData(); fd.append('file', file, file.name);
    return api(`/api/issue/${encodeURIComponent(issueKey)}/attachments`, { method: 'POST', body: fd, quiet: true });
  };
  const addComment = async (text, uploaded) => {
    await api(`/api/issue/${encodeURIComponent(issueKey)}/comments`, { method: 'POST', json: { text, attachmentIds: uploaded.map((u) => u.id) } });
    load();
  };
  // 첨부 파일 추가 ('+' 메뉴·첨부 칸의 '+'): 여러 개 골라 올리고 첨부 칸으로 이동
  const uploadPicked = async (files) => {
    for (const f of [...(files ?? [])]) {
      const fd = new FormData(); fd.append('file', f, f.name);
      await api(`/api/issue/${encodeURIComponent(issueKey)}/attachments`, { method: 'POST', body: fd });
    }
    if (fileRef.current) fileRef.current.value = '';
    await load();
    setTimeout(() => secRef.attach.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30);
  };
  const removeLink = async (l) => { await api(`/api/links/${l.id}`, { method: 'DELETE' }); load(); onChanged?.(); };
  const removeWebLink = async (w) => { await api(`/api/weblinks/${w.id}`, { method: 'DELETE' }); load(); };

  const saveDesc = async () => {
    const ed = descEditorRef.current;
    const descriptionAdf = ed && !ed.isEmpty ? tiptapToAdf(ed.getJSON()) : null;
    setDescEditing(false);
    await patch({ descriptionAdf });
  };
  const saveComment = async (text, uploaded) => {
    await api('/api/comments/' + editingComment.id, { method: 'PATCH', json: { text, attachmentIds: uploaded.map((u) => u.id) } });
    setEditingComment(null); load();
  };

  const doneCnt = d.subtasks.filter((s) => s.status_category === 'done').length;
  const pct = d.subtasks.length ? Math.round(doneCnt * 100 / d.subtasks.length) : 0;
  const verNames = [...new Set([...pdata.versions.map((v) => v.name), ...(d.fix_versions ?? [])])];
  const openSprints = pdata.sprints.filter((s) => s.state !== 'closed' || s.id === d.sprint_id);
  const proj = meta.projects.find((p) => p.key === issueKey.split('-')[0]);
  const priorityItems = [
    { value: '', label: '없음', node: <span className="dim">없음</span> },
    ...[...meta.priorities].sort((a, b) => (PRIORITY_ORDER[a] ?? 9) - (PRIORITY_ORDER[b] ?? 9))
      .map((p) => ({ value: p, label: p, node: <><Prio p={p} /> <span>{p}</span></> })),
  ];
  const assigneeItems = [
    { value: '', label: '미지정', node: <span className="dim">미지정</span> },
    ...meta.assignees.map((u) => ({ value: String(u.id), label: u.display_name, node: <><Avatar name={u.display_name} /> <span>{u.display_name}</span></> })),
  ];
  const sprintItems = [
    { value: '', label: '백로그', node: <span>백로그</span> },
    ...openSprints.map((s) => ({ value: String(s.id), label: s.name, node: <span>{s.name}{s.state === 'active' ? ' (활성)' : s.state === 'closed' ? ' (완료)' : ''}</span> })),
  ];
  const project = proj?.key ?? issueKey.split('-')[0];

  // ---------- 활동 (전체/댓글/기록) ----------
  const history = d.history ?? [];
  const statusByName = new Map(meta.statuses.map((s) => [s.name, s]));
  const feed = (actTab === 'comments' ? d.comments.map((c) => ({ t: 'c', at: c.created_at, c }))
    : actTab === 'history' ? history.map((h) => ({ t: 'h', at: h.created_at, h }))
    : actTab === 'worklog' ? []
    : [...d.comments.map((c) => ({ t: 'c', at: c.created_at, c })), ...history.map((h) => ({ t: 'h', at: h.created_at, h }))])
    .sort((a, b) => new Date(b.at) - new Date(a.at));

  const commentBlock = (c) => (
    <div className="comment" key={'c' + c.id}>
      <Avatar name={c.author_name} />
      <div className="comment-main">
        <div className="comment-head">
          <b>{c.author_name ?? '?'}</b>
          {!mobile && editingComment?.id !== c.id &&
            <button type="button" className="comment-edit" title="댓글 편집"
              onClick={() => setEditingComment({ id: c.id, text: adfPlain(c.body_adf) })}>✎</button>}
        </div>
        <div className="comment-time">{relTime(c.created_at)}</div>
        {!mobile && editingComment?.id === c.id
          ? <>
              <CommentComposer key={'e' + c.id} upload={uploadFile} initialText={editingComment.text} autoFocus mini
                submitLabel="저장" onSubmit={saveComment} onCancel={() => setEditingComment(null)} />
              {(c.body_adf?.content ?? []).some((n) => n.type === 'mediaSingle' || n.type === 'mediaGroup') &&
                <div className="dim composer-keep">기존 이미지·첨부는 그대로 유지됩니다.</div>}
            </>
          : <div className="comment-body"><AdfView doc={c.body_adf} attachments={d.attachments} /></div>}
      </div>
    </div>
  );

  const historyValue = (field, value) => {
    if (value == null || value === '' || value === '없음' || value === 'null') return <span className="dim">없음</span>;
    if (field === 'status') {
      const cat = statusByName.get(value)?.category ?? statusCategoryOf(value);
      return <span className={`badge cat-${cat ?? 'new'}`}>{value}</span>;
    }
    const parts = String(value).split(/(\b[A-Z][A-Z0-9]+-\d+\b)/g);
    return <span className="hist-val" title={String(value)}>
      {parts.map((p, i) => /^[A-Z][A-Z0-9]+-\d+$/.test(p)
        ? <span className="ilink" key={i} onClick={() => onOpen(p)}>{p}</span>
        : <React.Fragment key={i}>{p}</React.Fragment>)}
    </span>;
  };
  const historyBlock = (h) => {
    const items = h.items ?? [];
    const action = items.length === 1
      ? (HISTORY_ACTION[items[0].field] ?? `${items[0].field} 업데이트됨`)
      : `${items.length}개 필드 업데이트됨`;
    return (
      <div className="hist" key={'h' + h.id}>
        <Avatar name={h.author_name} />
        <div className="hist-body">
          <div className="hist-head"><b>{h.author_name ?? '?'}</b> <span>{action}</span></div>
          <div className="hist-time">{relTime(h.created_at)}</div>
          {items.map((it, i) => (it.field === 'description' && !it.fromString && !it.toString) ? null : (
            <div className="hist-item" key={i}>
              {historyValue(it.field, it.fromString)}
              <span className="hist-arrow">→</span>
              {historyValue(it.field, it.toString)}
            </div>))}
        </div>
      </div>
    );
  };

  const linkRow = (l, i) => {
    const mine = l.inward_key === issueKey; // 이 이슈가 inward 쪽 = 상대가 이 이슈를 가리킴
    const otherKey = mine ? l.outward_key : l.inward_key;
    const otherSum = mine ? l.outward_summary : l.inward_summary;
    return (
      <li key={l.id ?? i}><span className="dim">{linkPhrase(l.link_type, !mine)}</span>{' '}
        {otherKey
          ? <><span className="ilink" onClick={() => onOpen(otherKey)}>{otherKey}</span> {otherSum ?? ''}</>
          : <span className="dim">(이관 범위 밖 이슈)</span>}
        {canEdit && l.id && <button type="button" className="row-x" title="연결 삭제" onClick={() => confirm('이 연결을 지울까요?') && removeLink(l)}>✕</button>}
      </li>
    );
  };
  const canEdit = d.project_role && d.project_role !== 'viewer' && !mobile;
  const isEpic = d.type_name?.includes('에픽');
  const childTypes = (meta.types ?? []).filter((t) => (isEpic ? !t.subtask && !t.name.includes('에픽') : t.subtask))
    .sort((a, b) => (a.name === (isEpic ? '스토리' : '하위 작업') ? -1 : b.name === (isEpic ? '스토리' : '하위 작업') ? 1 : 0));
  const secHead = (title, onPlus) => (
    <div className="section-head"><span className="collapse"><IconChevronDown size={16} /></span><h3>{title}</h3>
      {onPlus && canEdit && <button type="button" className="sec-plus" title="추가" onClick={onPlus}><IconPlus size={15} /></button>}</div>);

  return (
    <div className="issue-view">
      <div className="issue-crumb">
        <a className="crumb-home" href="/for-you" title="홈" onClick={(e) => { e.preventDefault(); onHome?.(); }}>스페이스</a><span className="crumb-sep">/</span>
        <span className="crumb-cur">{proj?.name ?? issueKey.split('-')[0]}</span><span className="crumb-sep">/</span>
        {d.parent_key && <>
          <span className="ilink" title={d.parent_summary ?? ''} onClick={() => onOpen(d.parent_key)}>{d.parent_key}</span>
          <span className="crumb-sep">/</span>
        </>}
        <TypeIcon name={d.type_name} /><span className="crumb-key">{d.issue_key}</span>
      </div>
      <div className="issue-title-row">
        <InlineText as="h1" value={d.summary} placeholder="요약 입력"
          inputStyle={{ fontSize: 26, fontWeight: 600, margin: '4px 0 10px', maxWidth: 860 }}
          onSave={(v) => patch({ summary: v })} />
        <div className="issue-actions">
          {!mobile && <AddMenu onPick={openAdd} items={[
            [...(d.subtask ? [] : [{ key: 'subtask', icon: '☑', label: d.type_name?.includes('에픽') ? '하위 업무 항목 만들기' : '하위 작업 만들기', shortcut: '⇧C' }]),
             { key: 'link', icon: '🔗', label: '업무 항목 연결', shortcut: '⇧K' }],
            [{ key: 'attach', icon: '📎', label: '첨부 파일 추가' }, { key: 'weblink', icon: '🌐', label: '웹 링크 추가' }],
          ]} />}
        </div>
      </div>
      <div className="issue-meta-row">
        <span className="issue-meta-pill"><IconLock size={14} /> 제한됨</span>
        <span className="issue-meta-pill"><IconEye size={14} /> 1</span>
        <button className="toolbtn"><IconShare size={14} /> 공유</button>
      </div>
      <div className="dwrap">
        <div className="dmain">
          <section className="issue-section">
            <div className="section-head"><span className="collapse"><IconChevronDown size={16} /></span><h3>주요 세부 정보</h3></div>
            <dl className="fields2">
              <dt>컴포넌트</dt><dd>
                <MultiPicker values={d.components ?? []} options={pdata.components ?? []}
                  emptyLabel="컴포넌트 추가" addLabel="컴포넌트 추가" searchPlaceholder="컴포넌트 검색"
                  onChange={(v) => patch({ components: v })} /></dd>
              <dt>우선 순위</dt><dd>
                <SelectPicker value={d.priority ?? ''} items={priorityItems} searchable={false} width={260}
                  display={<><Prio p={d.priority} /><span>{d.priority ?? '없음'}</span></>}
                  onSelect={(v) => patch({ priority: v || null })} /></dd>
              <dt>상위 항목</dt><dd>
                <ParentPicker project={project} issueKey={issueKey} parentKey={d.parent_key} parentSummary={d.parent_summary}
                  onPick={(key) => patch({ parentKey: key })} onOpen={onOpen} /></dd>
              <dt>수정 버전</dt><dd>
                <MultiPicker values={d.fix_versions ?? []} options={verNames}
                  emptyLabel="수정 버전 추가" addLabel="수정 버전 추가" searchPlaceholder="버전 검색"
                  onChange={(v) => patch({ fixVersions: v })} /></dd>
              <dt>레이블</dt><dd>
                <MultiPicker values={d.labels ?? []} options={pdata.labels ?? []}
                  emptyLabel="레이블 추가" addLabel="레이블 추가" searchPlaceholder="레이블 검색"
                  onChange={(v) => patch({ labels: v })} /></dd>
              <dt>담당자</dt><dd>
                <SelectPicker value={d.assignee_id == null ? '' : String(d.assignee_id)} items={assigneeItems} searchable width={280}
                  display={<><Avatar name={d.assignee_name} /><span>{d.assignee_name ?? '미지정'}</span></>}
                  onSelect={(v) => patch({ assigneeId: v ? Number(v) : null })} />
                {me && String(d.assignee_id) !== String(me.id) &&
                  <button type="button" className="add-link" onClick={() => patch({ assigneeId: me.id })}>나에게 할당</button>}
              </dd>
              <dt>Sprint</dt><dd>
                <SelectPicker value={d.sprint_id == null ? '' : String(d.sprint_id)} items={sprintItems} width={280}
                  display={<span>{d.sprint_name ?? '백로그'}</span>}
                  onSelect={(v) => patch({ sprintId: v ? Number(v) : null })} /></dd>
            </dl>
            <div className="fieldrow"><div className="flabel2">설명</div>
              {!mobile && descEditing
                ? <>
                    {hasRichContent(d.description_adf) && (
                      <div className="adf"><div className="panel warning" style={{ fontSize: 12 }}>
                        패널·이미지·멘션 등 일부 요소는 편집기에서 단순화되어 표시됩니다. 저장하면 단순화된 형태로 대체됩니다.</div></div>)}
                    <DescEditor initialAdf={d.description_adf} onReady={(ed) => { descEditorRef.current = ed; }} />
                    <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                      <button className="primary mini" onClick={saveDesc}>저장</button>
                      <button className="mini" onClick={() => setDescEditing(false)}>취소</button>
                    </div>
                  </>
                : <div className="inline-edit" title="클릭하여 편집" onClick={() => { if (!isMobile()) setDescEditing(true); }}>
                    <AdfView doc={d.description_adf} attachments={d.attachments} />
                  </div>}
            </div>
          </section>

          <input type="file" multiple ref={fileRef} hidden onChange={(e) => uploadPicked(e.target.files)} />
          <section className="issue-section" ref={secRef.attach}>{secHead(`첨부 파일 (${d.attachments.length})`, () => openAdd('attach'))}
            <ul className="att-list">{d.attachments.map((a) => (
              <li key={a.id}><a href={`/api/attachment/${a.id}`} target="_blank" rel="noreferrer">{a.filename}</a>
                <span className="dim">{fileSize(a.file_size)} · {dt(a.created_at)}</span></li>))}
            </ul>
          </section>

          {(!d.subtask || d.subtasks.length > 0) && (
            <section className="issue-section" ref={secRef.subtask}>{secHead(`${isEpic ? '하위 업무 항목' : '하위 작업'}${d.subtasks.length ? ` (${d.subtasks.length})` : ''}`, d.subtask ? null : () => openAdd('subtask'))}
              {d.subtasks.length > 0 && <div className="subpanel">
                <div className="phead"><div className="pbar"><div style={{ width: `${pct}%` }} /></div><span className="dim">{pct}% 완료</span></div>
                <table>
                  <thead><tr><th>업무</th><th>타입</th><th>우선 순위</th><th>담당자</th><th>상태</th></tr></thead>
                  <tbody>{d.subtasks.map((s) => (
                    <tr key={s.issue_key}>
                      <td>
                        <TypeIcon name={s.type_name} />{' '}
                        <span className={`ilink skey${s.status_category === 'done' ? ' done' : ''}`} onClick={() => onOpen(s.issue_key)}>{s.issue_key}</span>{' '}
                        <span className="ilink" style={{ color: 'inherit' }} onClick={() => onOpen(s.issue_key)}>{s.summary}</span>
                      </td>
                      <td className="dim">{s.type_name ?? ''}</td>
                      <td><Prio p={s.priority} /> {s.priority ?? ''}</td>
                      <td><Avatar name={s.assignee_name} /> {s.assignee_name ?? ''}</td>
                      <td><StatusSelect small statuses={meta.statuses} value={s.status_id} category={s.status_category}
                        onChange={async (id) => { await api('/api/issue/' + encodeURIComponent(s.issue_key), { method: 'PATCH', json: { statusId: id } }); load(); }} /></td>
                    </tr>))}
                  </tbody>
                </table>
              </div>}
              {adding === 'subtask' && <SubtaskInline issue={d} types={childTypes} onCreated={() => { load(); onChanged?.(); }} onCancel={() => setAdding(null)} />}
            </section>)}

          {(d.links.length > 0 || adding === 'link') && (
            <section className="issue-section" ref={secRef.link}>{secHead(`연결된 업무 항목${d.links.length ? ` (${d.links.length})` : ''}`, () => openAdd('link'))}
              <ul className="link-list">{d.links.map(linkRow)}</ul>
              {adding === 'link' && <LinkInline issueKey={issueKey} onDone={() => { setAdding(null); load(); onChanged?.(); }} onCancel={() => setAdding(null)} />}
            </section>)}
          {((d.weblinks ?? []).length > 0 || adding === 'weblink') && (
            <section className="issue-section" ref={secRef.weblink}>{secHead(`웹 링크${d.weblinks?.length ? ` (${d.weblinks.length})` : ''}`, () => openAdd('weblink'))}
              <ul className="link-list">{(d.weblinks ?? []).map((w) => (
                <li key={w.id}>🌐 <a href={w.url} target="_blank" rel="noreferrer noopener">{w.title || w.url}</a>
                  {w.title && <span className="dim"> {(() => { try { return new URL(w.url).hostname; } catch { return ''; } })()}</span>}
                  {canEdit && <button type="button" className="row-x" title="웹 링크 삭제" onClick={() => confirm('이 웹 링크를 지울까요?') && removeWebLink(w)}>✕</button>}
                </li>))}</ul>
              {adding === 'weblink' && <WebLinkInline issueKey={issueKey} onDone={() => { setAdding(null); load(); }} onCancel={() => setAdding(null)} />}
            </section>)}

          <section className="issue-section"><div className="section-head"><span className="collapse"><IconChevronDown size={16} /></span><h3>활동</h3></div>
            <div className="acttabs">
              {[['all', '전체'], ['comments', '댓글'], ['history', '기록'], ['worklog', '업무 로그']]
                .map(([k, label]) => (
                  <button key={k} className={actTab === k ? 'on' : ''} onClick={() => setActTab(k)}>{label}</button>))}
            </div>
            {/* 활동은 최신순이라 Jira처럼 댓글 입력창을 목록 위에 둔다 */}
            {actTab !== 'history' && actTab !== 'worklog' && (
              <div className="composer-top">
                <CommentComposer key={'new-' + issueKey} upload={uploadFile} onSubmit={addComment} />
              </div>)}
            {feed.map((e) => e.t === 'c' ? commentBlock(e.c) : historyBlock(e.h))}
            {actTab === 'worklog' && <div className="activity-empty">업무 로그가 없습니다.</div>}
          </section>
        </div>

        <div className="dside">
          <div className="side-status">
            <StatusSelect statuses={meta.statuses} value={d.status_id} category={d.status_category}
              onChange={(id) => patch({ statusId: id })} />
            {d.resolved_at && <span className="done-mark"><IconCheck size={14} /> {d.resolution ?? '해결됨'}</span>}
          </div>
          <div className="dcard">
            <div className="dcard-head"><IconChevronDown size={16} /><span>세부 사항</span></div>
            <div className="body"><dl>
              <dt>Story point estimate</dt><dd><span className="add-link">스토리 포인트 추가</span></dd>
              <dt>보고자</dt><dd><span className="person"><Avatar name={d.reporter_name} /><span>{d.reporter_name ?? '-'}</span></span></dd>
            </dl></div>
          </div>
          <div className="dcard">
            <div className="dcard-head"><IconChevronRight size={16} /><span>더 많은 필드</span></div>
            <div className="body"><dl>
              <dt>타입</dt><dd>
                <span className="type-cell"><TypeIcon name={meta.types.find((t) => Number(t.id) === Number(d.issue_type_id))?.name} />
                <select value={d.issue_type_id ?? ''} onChange={(e) => patch({ typeId: Number(e.target.value) })}>
                  {meta.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select></span></dd>
            </dl></div>
          </div>
          <div className="dtimes">
            만듦 {dt(d.created_at)}<br />업데이트 {dt(d.updated_at)}
            {d.resolved_at && <><br />해결됨 {dt(d.resolved_at)}</>}
          </div>
        </div>
      </div>
    </div>
  );
}

