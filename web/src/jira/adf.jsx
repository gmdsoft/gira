// ADF(Atlassian Document Format) → React 읽기 전용 렌더러
import { linkParts } from '../../../server/src/linkify.mjs';
import { attachmentMaps, matchMedia, fileSize } from './adf-media.js';
import { sourceLink, safeUrl, embedUrl, alignment, mediaBorder } from './adf-links.js';
import React, { useContext, useEffect, useState } from 'react';

// 첨부 매핑: 원본 media UUID → Gira 첨부 id → 파일명 순서.
const AttCtx = React.createContext(null);

function Media({ n }) {
  const maps = useContext(AttCtx) ?? {};
  const a = n.attrs ?? {};
  if (a.type === 'external' && a.url) {
    return <img className="adf-img" src={a.url} alt={a.alt ?? ''} loading="lazy"
      style={{ ...mediaBorder(n), maxWidth: '100%', width: a.width ? Math.min(a.width, 740) : undefined }} />;
  }
  const hit = matchMedia(a, maps);
  if (hit && (hit.media_type ?? '').startsWith('image/')) {
    return <img className="adf-img" src={`/api/attachment/${hit.id}`} alt={a.alt ?? hit.filename} loading="lazy"
      style={{ ...mediaBorder(n), maxWidth: '100%', width: a.width ? Math.min(a.width, 740) : undefined }} />;
  }
  if (hit) return <a className="adf-file-card" href={`/api/attachment/${hit.id}`} download={hit.filename}>
    <span aria-hidden="true">📄</span><span className="adf-file-info"><strong>{hit.filename}</strong>
      <span className="dim">{fileSize(hit.file_size)} · 다운로드</span></span></a>;
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
    else if (m.type === 'backgroundColor') el = <span style={{ backgroundColor: m.attrs?.color }}>{el}</span>;
    else if (m.type === 'subsup') el = m.attrs?.type === 'sub' ? <sub>{el}</sub> : <sup>{el}</sup>;
  }
  return el;
}

function Card({ n }) {
  const raw = n.attrs?.url;
  const link = sourceLink(raw);
  const [issue, setIssue] = useState(null);
  const [page, setPage] = useState(null);
  useEffect(() => {
    setIssue(null); setPage(null);
    const controller = new AbortController();
    const url = link?.kind === 'issue' ? `/api/issue/${link.key}`
      : link?.kind === 'page' ? `/api/adf/page-link?url=${encodeURIComponent(raw)}` : null;
    if (url) fetch(url, { signal: controller.signal }).then(r => r.ok ? r.json() : null).then(data => {
      if (link.kind === 'issue') setIssue(data); else setPage(data);
    }).catch(() => {});
    return () => controller.abort();
  }, [raw]);
  const embed = n.type === 'embedCard' && embedUrl(raw);
  if (embed) return <iframe className="adf-embed" src={embed} title={n.attrs?.title || 'Figma'} sandbox="allow-scripts allow-same-origin" loading="lazy" referrerPolicy="no-referrer" />;
  const href = link?.kind === 'issue' ? link.href : page?.href ?? safeUrl(raw);
  // 원본 카드 제목이 사이트 주소뿐이면(예: https://gmdsoft.atlassian.net/) 의미가 없으니 원래 주소 전체를 보여 준다
  const cardTitle = /^https?:\/\/[^/]+\/?$/.test(n.attrs?.title ?? '') ? null : n.attrs?.title;
  const label = link?.kind === 'issue' ? `${link.key}${issue?.summary ? ': ' + issue.summary : ''}` : page?.title || cardTitle || raw || '링크';
  return <span className={n.type === 'inlineCard' ? 'adf-inline-card' : 'adf-link-card'}>
    {href ? <a href={href} title={raw} target="_blank" rel="noopener noreferrer">{label}</a> : label}
    {issue?.status_name && <span className={`status-lozenge cat-${issue.status_category || 'new'}`}>{issue.status_name}</span>}
  </span>;
}

const STATUS_CAT = { green: 'cat-done', blue: 'cat-indeterminate', neutral: 'cat-new', red: 'cat-new', yellow: 'cat-indeterminate', purple: 'cat-indeterminate' };

function Kids({ n }) { return <>{(n.content ?? []).map((c, i) => <Node key={i} n={c} />)}</>; }

function Node({ n }) {
  if (!n) return null;
  switch (n.type) {
    case 'doc': return <Kids n={n} />;
    case 'paragraph': return <p style={{ textAlign: alignment(n) }}>{n.content?.length ? <Kids n={n} /> : ' '}</p>;
    case 'text': return <Marked text={n.text} marks={n.marks} />;
    case 'heading': {
      const H = `h${Math.min(6, n.attrs?.level ?? 1)}`;
      return <H style={{ textAlign: alignment(n) }}><Kids n={n} /></H>;
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
    case 'mediaSingle': return <div className="media-row"><Kids n={n} /></div>;
    case 'mediaGroup': return <div className="media-row media-group"><Kids n={n} /></div>; // 파일 묶음은 카드를 가로로 (원본과 같게)
    case 'media': case 'mediaInline': return <Media n={n} />;
    case 'inlineCard': case 'blockCard': case 'embedCard': return <Card n={n} />;
    case 'decisionList': return <ul className="adf-decisions"><Kids n={n} /></ul>;
    case 'decisionItem': return <li data-state={n.attrs?.state}><span aria-label="결정">◆</span> <span className="status-lozenge">{n.attrs?.state === 'DECIDED' ? '결정됨' : '미결정'}</span> <Kids n={n} /></li>;
    case 'expand': case 'nestedExpand':
      return <details className="expand"><summary>{n.attrs?.title || '펼치기'}</summary><div className="expand-body"><Kids n={n} /></div></details>;
    default: return <Kids n={n} />;
  }
}

export default function AdfView({ doc, attachments }) {
  if (!doc) return <span className="dim">없음</span>;
  const maps = attachmentMaps(attachments ?? []);
  return (
    <AttCtx.Provider value={maps}>
      <div className="adf"><Node n={doc} /></div>
    </AttCtx.Provider>
  );
}
