// ADF(Atlassian Document Format) → React 읽기 전용 렌더러
import { linkParts } from '../../../server/src/linkify.mjs';
import React, { useContext } from 'react';

// 첨부 매핑: media 노드 → 이슈 첨부. Gira에서 단 댓글은 attrs.id(첨부 id, collection 'gira'),
// 이관된 Jira 본문은 alt(파일명)로 찾는다. 이미지면 인라인으로 보여준다.
const AttCtx = React.createContext(null);

function Media({ n }) {
  const { byName, byId } = useContext(AttCtx) ?? {};
  const a = n.attrs ?? {};
  if (a.type === 'external' && a.url) {
    return <img className="adf-img" src={a.url} alt={a.alt ?? ''} loading="lazy"
      style={{ maxWidth: '100%', width: a.width ? Math.min(a.width, 740) : undefined }} />;
  }
  const hit = (a.collection === 'gira' && a.id ? byId?.get(String(a.id)) : null)
    ?? (a.alt ? byName?.get(String(a.alt).toLowerCase()) : null);
  if (hit && (hit.media_type ?? '').startsWith('image/')) {
    return <img className="adf-img" src={`/api/attachment/${hit.id}`} alt={a.alt} loading="lazy"
      style={{ maxWidth: '100%', width: a.width ? Math.min(a.width, 740) : undefined }} />;
  }
  if (hit) return <a href={`/api/attachment/${hit.id}`} target="_blank" rel="noopener noreferrer">📎 {a.alt}</a>;
  return <span className="media-ph">📎 {a.alt || '첨부 미디어'} <span className="dim">(첨부 목록 참조)</span></span>;
}

function Marked({ text, marks }) {
  // 링크·코드 표시가 없는 글자 속 주소는 링크로 (예전에 글자로만 저장된 댓글·설명 포함)
  if (!(marks ?? []).some((m) => m.type === 'link' || m.type === 'code')) {
    const parts = linkParts(text);
    if (parts.some((p) => p.href)) {
      return <>{parts.map((p, i) => <Marked key={i} text={p.text} marks={p.href ? [...(marks ?? []), { type: 'link', attrs: { href: p.href } }] : marks} />)}</>;
    }
  }
  let el = <>{text}</>;
  for (const m of marks ?? []) {
    if (m.type === 'strong') el = <strong>{el}</strong>;
    else if (m.type === 'em') el = <em>{el}</em>;
    else if (m.type === 'underline') el = <u>{el}</u>;
    else if (m.type === 'strike') el = <s>{el}</s>;
    else if (m.type === 'code') el = <code>{el}</code>;
    else if (m.type === 'link') el = <a href={m.attrs?.href} target="_blank" rel="noopener noreferrer">{el}</a>;
    else if (m.type === 'textColor') el = <span style={{ color: m.attrs?.color }}>{el}</span>;
    else if (m.type === 'subsup') el = m.attrs?.type === 'sub' ? <sub>{el}</sub> : <sup>{el}</sup>;
  }
  return el;
}

const STATUS_CAT = { green: 'cat-done', blue: 'cat-indeterminate', neutral: 'cat-new', red: 'cat-new', yellow: 'cat-indeterminate', purple: 'cat-indeterminate' };

function Kids({ n }) { return <>{(n.content ?? []).map((c, i) => <Node key={i} n={c} />)}</>; }

function Node({ n }) {
  if (!n) return null;
  switch (n.type) {
    case 'doc': return <Kids n={n} />;
    case 'paragraph': return <p>{n.content?.length ? <Kids n={n} /> : ' '}</p>;
    case 'text': return <Marked text={n.text} marks={n.marks} />;
    case 'heading': {
      const H = `h${Math.min(6, n.attrs?.level ?? 1)}`;
      return <H><Kids n={n} /></H>;
    }
    case 'bulletList': return <ul><Kids n={n} /></ul>;
    case 'orderedList': return <ol><Kids n={n} /></ol>;
    case 'listItem': return <li><Kids n={n} /></li>;
    case 'taskList': return <ul style={{ listStyle: 'none', paddingLeft: 16 }}><Kids n={n} /></ul>;
    case 'taskItem': return <li>{n.attrs?.state === 'DONE' ? '☑' : '☐'} <Kids n={n} /></li>;
    case 'codeBlock': return <pre><code>{(n.content ?? []).map((t) => t.text).join('')}</code></pre>;
    case 'blockquote': return <blockquote><Kids n={n} /></blockquote>;
    case 'panel': return <div className={`panel ${n.attrs?.panelType ?? 'info'}`}><Kids n={n} /></div>;
    case 'rule': return <hr />;
    case 'hardBreak': return <br />;
    case 'mention': return <span className="mention">@{n.attrs?.text?.replace(/^@/, '') ?? '?'}</span>;
    case 'emoji': return <>{n.attrs?.text ?? n.attrs?.shortName ?? ''}</>;
    case 'date': return <span className="inline-date">{n.attrs?.timestamp ? new Date(Number(n.attrs.timestamp)).toLocaleDateString('ko-KR') : ''}</span>;
    case 'status': return <span className={`status-lozenge ${STATUS_CAT[n.attrs?.color] ?? 'cat-new'}`}>{n.attrs?.text}</span>;
    case 'table': return <table><tbody><Kids n={n} /></tbody></table>;
    case 'tableRow': return <tr><Kids n={n} /></tr>;
    case 'tableHeader': return <th colSpan={n.attrs?.colspan} rowSpan={n.attrs?.rowspan}><Kids n={n} /></th>;
    case 'tableCell': return <td colSpan={n.attrs?.colspan} rowSpan={n.attrs?.rowspan}><Kids n={n} /></td>;
    case 'mediaSingle': case 'mediaGroup': return <div className="media-row"><Kids n={n} /></div>;
    case 'media': case 'mediaInline': return <Media n={n} />;
    case 'inlineCard': return <a href={n.attrs?.url} target="_blank" rel="noopener noreferrer">{n.attrs?.url}</a>;
    case 'expand': case 'nestedExpand':
      return <details className="expand"><summary>{n.attrs?.title || '펼치기'}</summary><div className="expand-body"><Kids n={n} /></div></details>;
    default: return <Kids n={n} />;
  }
}

export default function AdfView({ doc, attachments }) {
  if (!doc) return <span className="dim">없음</span>;
  const byName = new Map((attachments ?? []).map((a) => [String(a.filename).toLowerCase(), a]));
  const byId = new Map((attachments ?? []).map((a) => [String(a.id), a]));
  return (
    <AttCtx.Provider value={{ byName, byId }}>
      <div className="adf"><Node n={doc} /></div>
    </AttCtx.Provider>
  );
}
