// 이슈 상세: Jira식 2단 (본문 가변 + 우측 고정 패널), 하위 작업 패널, 인라인 필드 변경, 편집 모드
import React, { useEffect, useRef, useState } from 'react';
import { api, dt, fileSize, Prio, Avatar, StatusSelect } from './util.jsx';
import AdfView from './adf.jsx';
import DescEditor from './DescEditor.jsx';
import { tiptapToAdf, hasRichContent } from './adf-convert.js';

export default function IssueDetail({ issueKey, meta, pdata, onOpen, onChanged, onTitle }) {
  const [d, setD] = useState(null);
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState('');
  const fileRef = useRef(null);

  const load = async () => {
    const data = await api('/api/issue/' + encodeURIComponent(issueKey));
    setD(data);
    onTitle?.(`[${data.issue_key}] ${data.summary} - Jira PoC`);
  };
  useEffect(() => { setEditing(false); setComment(''); load(); }, [issueKey]);

  if (!d) return <div className="placeholder">불러오는 중…</div>;

  const patch = async (json, reload = true) => {
    await api('/api/issue/' + encodeURIComponent(issueKey), { method: 'PATCH', json });
    if (reload) { load(); onChanged?.(); }
  };
  const changeParent = async () => {
    const v = prompt('상위 이슈 키 (비우면 상위 해제)', d.parent_key ?? '');
    if (v === null) return;
    patch({ parentKey: v.trim() });
  };
  const addComment = async () => {
    const text = comment.trim();
    if (!text) return;
    await api(`/api/issue/${encodeURIComponent(issueKey)}/comments`, { method: 'POST', json: { text } });
    setComment(''); load();
  };
  const upload = async () => {
    const f = fileRef.current?.files[0];
    if (!f) return alert('파일을 선택하세요');
    const fd = new FormData(); fd.append('file', f);
    await api(`/api/issue/${encodeURIComponent(issueKey)}/attachments`, { method: 'POST', body: fd });
    fileRef.current.value = ''; load();
  };

  if (editing) return <EditForm d={d} onDone={() => { setEditing(false); load(); onChanged?.(); }} onCancel={() => setEditing(false)} />;

  const doneCnt = d.subtasks.filter((s) => s.status_category === 'done').length;
  const pct = d.subtasks.length ? Math.round(doneCnt * 100 / d.subtasks.length) : 0;
  const verNames = [...new Set([...pdata.versions.map((v) => v.name), ...(d.fix_versions ?? [])])];
  const resoList = [...new Set([...meta.resolutions, ...(d.resolution ? [d.resolution] : [])])];
  const openSprints = pdata.sprints.filter((s) => s.state !== 'closed' || s.id === d.sprint_id);

  const linkRow = (l, i) => {
    const mine = l.inward_key === issueKey;
    const otherKey = mine ? l.outward_key : l.inward_key;
    const otherSum = mine ? l.outward_summary : l.inward_summary;
    return (
      <li key={i}><span className="dim">{l.link_type}</span>{' '}
        {otherKey
          ? <><span className="ilink" onClick={() => onOpen(otherKey)}>{otherKey}</span> {otherSum ?? ''}</>
          : <span className="dim">(이관 범위 밖 이슈)</span>}
      </li>
    );
  };

  return (
    <>
      <div className="dkey">
        {d.parent_key
          ? <><span className="ilink" title={d.parent_summary ?? ''} onClick={() => onOpen(d.parent_key)}>{d.parent_key}</span>
              <button className="plain dim" title="상위 항목 변경" onClick={changeParent}>✎</button> / </>
          : <><button className="mini" onClick={changeParent}>상위 항목 추가</button> / </>}
        {d.issue_key}
        <button className="mini" style={{ marginLeft: 8 }} onClick={() => setEditing(true)}>편집</button>
      </div>
      <h2>{d.summary}</h2>
      <div className="dwrap">
        <div className="dmain">
          <section><h3>설명</h3><AdfView doc={d.description_adf} /></section>

          {d.subtasks.length > 0 && (
            <section><h3>하위 작업 ({d.subtasks.length})</h3>
              <div className="subpanel">
                <div className="phead"><div className="pbar"><div style={{ width: `${pct}%` }} /></div><span className="dim">{pct}% 완료</span></div>
                <table>
                  <thead><tr><th>업무</th><th>타입</th><th>우선 순위</th><th>담당자</th><th>상태</th></tr></thead>
                  <tbody>{d.subtasks.map((s) => (
                    <tr key={s.issue_key}>
                      <td>
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
              </div>
            </section>)}

          {d.links.length > 0 && <section><h3>연결된 업무 항목 ({d.links.length})</h3><ul className="link-list">{d.links.map(linkRow)}</ul></section>}

          <section><h3>첨부 파일 ({d.attachments.length})</h3>
            <ul className="att-list">{d.attachments.map((a) => (
              <li key={a.id}><a href={`/api/attachment/${a.id}`} target="_blank" rel="noreferrer">{a.filename}</a>
                <span className="dim">{fileSize(a.file_size)} · {dt(a.created_at)}</span></li>))}
            </ul>
            <div className="cform"><input type="file" ref={fileRef} /> <button onClick={upload}>업로드</button></div>
          </section>

          <section><h3>댓글 ({d.comments.length})</h3>
            {d.comments.map((c) => (
              <div className="comment" key={c.id}>
                <div className="chead"><Avatar name={c.author_name} /> <b>{c.author_name ?? '?'}</b> · {dt(c.created_at)}</div>
                <AdfView doc={c.body_adf} />
              </div>))}
            <div className="cform">
              <textarea placeholder="댓글 입력 (플레인 텍스트)" value={comment} onChange={(e) => setComment(e.target.value)} />
              <div className="actions"><button className="primary" onClick={addComment}>댓글 달기</button></div>
            </div>
          </section>
        </div>

        <div className="dside">
          <div style={{ marginBottom: 12 }}>
            <StatusSelect statuses={meta.statuses} value={d.status_id} category={d.status_category}
              onChange={(id) => patch({ statusId: id })} />
            {d.resolved_at && <span className="dim" style={{ marginLeft: 6 }}>✓ {d.resolution ?? '해결됨'}</span>}
          </div>
          <div className="dcard">
            <h4>세부 사항</h4>
            <div className="body"><dl>
              <dt>담당자</dt><dd>
                <select value={d.assignee_id ?? ''} onChange={(e) => patch({ assigneeId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">미지정</option>
                  {meta.assignees.map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}
                </select></dd>
              <dt>보고자</dt><dd><Avatar name={d.reporter_name} /> {d.reporter_name ?? '-'}</dd>
              <dt>타입</dt><dd>
                <select value={d.issue_type_id ?? ''} onChange={(e) => patch({ typeId: Number(e.target.value) })}>
                  {meta.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select></dd>
              <dt>우선순위</dt><dd>
                <select value={d.priority ?? ''} onChange={(e) => patch({ priority: e.target.value || null })}>
                  <option value="">없음</option>
                  {meta.priorities.map((p) => <option key={p} value={p}>{p}</option>)}
                </select></dd>
              <dt>스프린트</dt><dd>
                <select value={d.sprint_id ?? ''} onChange={(e) => patch({ sprintId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">백로그</option>
                  {openSprints.map((s) => <option key={s.id} value={s.id}>
                    {s.name}{s.state === 'active' ? ' (활성)' : s.state === 'closed' ? ' (완료)' : ''}</option>)}
                </select></dd>
              <dt>해결</dt><dd>
                <select value={d.resolution ?? ''} onChange={(e) => patch({ resolution: e.target.value || null })}>
                  <option value="">미해결</option>
                  {resoList.map((r) => <option key={r} value={r}>{r}</option>)}
                </select></dd>
              <dt>수정 버전</dt><dd>
                <select multiple size={Math.min(4, Math.max(2, verNames.length))} title="Ctrl 클릭으로 복수 선택"
                  value={d.fix_versions ?? []}
                  onChange={(e) => patch({ fixVersions: [...e.target.selectedOptions].map((o) => o.value) }, false)}>
                  {verNames.map((v) => <option key={v} value={v}>{v}</option>)}
                </select></dd>
              {d.labels?.length > 0 && <><dt>라벨</dt><dd>{d.labels.map((l) => <span className="chip" key={l}>{l}</span>)}</dd></>}
              {d.components?.length > 0 && <><dt>컴포넌트</dt><dd>{d.components.map((c) => <span className="chip" key={c}>{c}</span>)}</dd></>}
            </dl></div>
            <div className="dtimes">
              만듦 {dt(d.created_at)}<br />업데이트 {dt(d.updated_at)}
              {d.resolved_at && <><br />해결됨 {dt(d.resolved_at)}</>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function EditForm({ d, onDone, onCancel }) {
  const [summary, setSummary] = useState(d.summary);
  const [labels, setLabels] = useState((d.labels ?? []).join(', '));
  const editorRef = useRef(null);
  const save = async () => {
    if (!summary.trim()) return alert('요약을 입력하세요');
    const ed = editorRef.current;
    const descriptionAdf = ed && !ed.isEmpty ? tiptapToAdf(ed.getJSON()) : null;
    await api('/api/issue/' + encodeURIComponent(d.issue_key), { method: 'PATCH', json: {
      summary: summary.trim(),
      labels: labels.split(',').map((s) => s.trim()).filter(Boolean),
      descriptionAdf,
    } });
    onDone();
  };
  return (
    <div style={{ maxWidth: 760 }}>
      <div className="dkey">{d.issue_key} 편집</div>
      <label className="flabel">요약 *</label>
      <input type="text" style={{ width: '100%' }} value={summary} onChange={(e) => setSummary(e.target.value)} />
      <label className="flabel">라벨 (쉼표 구분)</label>
      <input type="text" style={{ width: '100%' }} value={labels} onChange={(e) => setLabels(e.target.value)} />
      <label className="flabel">설명</label>
      {hasRichContent(d.description_adf) && (
        <div className="adf"><div className="panel warning" style={{ fontSize: 12 }}>
          패널·이미지·멘션 등 일부 요소는 편집기에서 단순화되어 표시됩니다. 저장하면 단순화된 형태로 대체됩니다.</div></div>)}
      <DescEditor initialAdf={d.description_adf} onReady={(ed) => { editorRef.current = ed; }} />
      <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
        <button className="primary" onClick={save}>저장</button>
        <button onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}
