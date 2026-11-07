import { mediaTag } from '../../shared/media-macros.mjs';
import { storageChart } from './storage-chart.js';
import { selectAttachments } from '../../shared/macro-attachments.mjs';
import { templateId } from '../../shared/templates.mjs';
import { chartQuery, renderChart } from './jira-chart.js';
import { hydrateMermaid } from './mermaid-view.js';
import { hydrateIssueCard } from './issue-card.js';
import { hydrateLinkCard } from './link-card.js';
// 매크로 하이드레이터: 렌더된 본문의 .cf-macro-slot[data-macro]를 실데이터 위젯으로 교체한다.
// ctx = { page, navigate } — page는 /api/content/:id 응답(attachments·children 포함).
import { generateHTML } from '@tiptap/html';
import { extensions } from './extensions.js';
import { api, hydrateDoc } from './api.js';
import { createToc } from './toc.js';

export function hydrateMacros(root, ctx) {
  if (!root) return;
  hydrateMermaid(root);
  for (const el of root.querySelectorAll('a[data-link-card]')) {
    if (!el.dataset.hydrated) hydrateLinkCard(el);
  }
  for (const el of root.querySelectorAll('a.jira-issue[data-issue-key]')) {
    if (el.dataset.hydrated) continue;
    el.dataset.hydrated = '1';
    hydrateIssueCard(el);
  }
  for (const el of [...root.querySelectorAll('.cf-macro-slot[data-macro]')]) {
    if (el.dataset.hydrated) continue;
    el.dataset.hydrated = '1';
    let params = {};
    try { params = JSON.parse(el.dataset.params || '{}'); } catch { /* 빈 파라미터로 진행 */ }
    const fn = HANDLERS[el.dataset.macro];
    if (!fn) continue;
    Promise.resolve(fn(el, params, ctx)).catch(() => { /* 실패 시 배지 유지 */ });
  }
}

// 배지를 위젯으로 교체 (숨은 콘텐츠 홀은 보존)
function swap(el, widget) {
  el.querySelector('.macro-badge')?.replaceWith(widget);
}

function navLink(ctx, spaceKey, id, text) {
  const a = document.createElement('a');
  a.href = `/s/${spaceKey}/p/${id}`;
  a.textContent = text;
  a.addEventListener('click', (e) => { e.preventDefault(); ctx.navigate(a.getAttribute('href')); });
  return a;
}

function listWidget(cls, items) {
  const div = document.createElement('div');
  div.className = cls;
  const ul = document.createElement('ul');
  for (const it of items) { const li = document.createElement('li'); li.append(...[].concat(it)); ul.append(li); }
  div.append(ul);
  return div;
}

const fmtSize = (n) => !n ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ko-KR') : '';

function attInfo(ctx, params) {
  const filename = params.name?.['ri:filename'];
  if (!filename) return null;
  const meta = ctx.page.attachments?.find((a) => a.filename === filename);
  return { filename, meta, url: `/api/att/${ctx.page.id}/${encodeURIComponent(filename)}` };
}

function fileCard(info, { open = false } = {}) {
  const a = document.createElement('a');
  a.className = 'file-card';
  a.href = info.url;
  if (open) { a.target = '_blank'; a.rel = 'noreferrer'; a.title = '새 탭에서 열기'; }
  else { a.download = info.filename; }
  const ext = info.filename.split('.').pop()?.toLowerCase() ?? '';
  const icon = { pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗', ppt: '📙', pptx: '📙', zip: '🗜', hwp: '📄' }[ext] ?? '📎';
  a.innerHTML = `<span class="file-card-icon"></span><span class="file-card-name"></span><span class="file-card-size muted"></span>`;
  a.querySelector('.file-card-icon').textContent = icon;
  a.querySelector('.file-card-name').textContent = info.filename;
  a.querySelector('.file-card-size').textContent = fmtSize(info.meta?.file_size);
  return a;
}

function tableWidget(headers, rows) {
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const title of headers) { const th = document.createElement('th'); th.textContent = title; head.append(th); }
  const body = table.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    for (const value of row) { const td = tr.insertCell(); if (value instanceof Node) td.append(value); else td.textContent = value ?? ''; }
  }
  return table;
}
function emptyWidget(text) { const div = document.createElement('div'); div.className = 'muted'; div.textContent = text; return div; }
async function report(kind, params, ctx) {
  return api(`/api/macro-report/${kind}?space=${encodeURIComponent(ctx.page.spaceKey)}&params=${encodeURIComponent(JSON.stringify(params))}`);
}
function fieldWidget(content, ctx) {
  const div = document.createElement('div'); div.className = 'doc';
  div.innerHTML = generateHTML(hydrateDoc({ type: 'doc', content: structuredClone(content ?? []) }, ctx.page.id), extensions);
  hydrateMacros(div, ctx);
  return div;
}
function macroNote(text) {
  const note = document.createElement('div');
  note.className = 'cf-macro-notice'; note.textContent = text;
  return note;
}

function sourceMacro(el, params, plantuml = false) {
  const box = document.createElement('div');
  box.append(macroNote(plantuml ? 'PlantUML 그림은 렌더 서버 연결 후 표시' : '이관되지 않은 위키 마크업 원문'));
  const pre = document.createElement('pre'), code = document.createElement('code');
  code.textContent = params.__body ?? ''; pre.append(code); box.append(pre);
  if (plantuml && params.__body) {
    const img = document.createElement('img');
    img.alt = 'PlantUML 다이어그램'; img.style.maxWidth = '100%';
    img.onload = () => box.prepend(img);
    img.src = `/api/plantuml/svg?src=${encodeURIComponent(params.__body)}`;
  }
  swap(el, box);
}

const HANDLERS = {
  multimedia(el, params, ctx) {
    const filename = typeof params.name === 'string' ? params.name : params.name?.['ri:filename'];
    const meta = ctx.page.attachments?.find(a => a.filename === filename);
    if (!meta) { swap(el, macroNote('미디어 첨부 파일을 찾을 수 없습니다.')); return; }
    const info = { filename, meta, url: `/api/att/${ctx.page.id}/${encodeURIComponent(filename)}` };
    const tag = mediaTag(filename);
    if (!tag) { swap(el, fileCard(info)); return; }
    const media = document.createElement(tag); media.src = info.url;
    if (tag === 'img') media.alt = filename;
    else { media.controls = true; media.preload = 'metadata'; media.append(fileCard(info)); }
    for (const key of ['width', 'height']) if (/^[1-9]\d*$/.test(String(params[key] ?? ''))) media.setAttribute(key, params[key]);
    media.style.maxWidth = '100%';
    swap(el, media);
  },
  gliffy(el, params, ctx) {
    const name = params.name;
    const rows = ctx.page.attachments ?? [];
    const preview = rows.find(a => a.filename === `${name}.png`)
      ?? rows.find(a => a.filename === name && (a.media_type?.startsWith('image/') || mediaTag(a.filename) === 'img'));
    if (!preview) { swap(el, macroNote('Gliffy 미리보기 첨부 파일을 찾을 수 없습니다.')); return; }
    const img = document.createElement('img');
    img.src = `/api/att/${ctx.page.id}/${encodeURIComponent(preview.filename)}`;
    img.alt = name; img.style.maxWidth = '100%';
    img.onerror = () => img.replaceWith(macroNote('Gliffy 미리보기를 불러올 수 없습니다.'));
    swap(el, img);
  },
  plantuml(el, params) { sourceMacro(el, params, true); },
  'unmigrated-wiki-markup'(el, params) { sourceMacro(el, params); },
  chart(el, params) {
    const chart = storageChart(el.querySelector('.cf-chart-body table'), params);
    if (chart) swap(el, chart); else el.querySelector('.macro-badge')?.remove();
  },
  async 'content-report-table'(el, params, ctx) {
    const rows = await report('content', params, ctx);
    swap(el, rows.length ? tableWidget(['제목', '작성자', '수정됨'], rows.map(r => [navLink(ctx, r.space_key, r.id, r.title), r.author_name, fmtDate(r.updated_at)])) : emptyWidget(params.blankDescription || '문서 없음'));
  },
  async 'tasks-report-macro'(el, params, ctx) {
    const rows = await report('tasks', params, ctx);
    swap(el, rows.length ? tableWidget(['작업', '문서', '담당', '기한'], rows.map(r => [r.text, navLink(ctx, r.space_key, r.id, r.title), r.assignees.join(', '), r.due])) : emptyWidget('완료되지 않은 작업을 찾을 수 없음'));
  },
  async decisionreport(el, params, ctx) {
    const rows = await report('decisions', params, ctx);
    swap(el, rows.length ? tableWidget(['결정', '문서'], rows.map(r => [r.text, navLink(ctx, r.space_key, r.id, r.title)])) : emptyWidget('결정 항목 없음'));
  },
  async detailssummary(el, params, ctx) {
    const data = await report('details', params, ctx);
    swap(el, tableWidget([params.firstcolumn || '제목', ...data.headings], data.rows.map(r => [navLink(ctx, r.space_key, r.id, r.title), ...data.headings.map(h => fieldWidget(r.fields[h], { ...ctx, page: { ...ctx.page, id: r.id, spaceKey: r.space_key } }))])));
  },
  async 'change-history'(el, params, ctx) {
    const rows = await api(`/api/content/${ctx.page.id}/versions`);
    swap(el, tableWidget(['버전', '작성자', '날짜', '변경 내용'], rows.slice(0, Math.max(1, Number(params.limit) || 3)).map(r => [String(r.version), r.author_name, fmtDate(r.created_at), r.message])));
  },
  async 'profile-picture'(el, params) {
    const user = params.User ?? params.user ?? {};
    const id = user['ri:account-id'] ?? user['ri:userkey'];
    if (!id) { swap(el, emptyWidget('사용자 없음')); return; }
    const u = await api(`/api/users/${encodeURIComponent(id)}`);
    const size = params.Size === 'extra large' ? 96 : 40;
    const avatar = document.createElement(u.avatar_url ? 'img' : 'span');
    avatar.title = u.display_name;
    avatar.style.cssText = `display:inline-flex;border-radius:50%;width:${size}px;height:${size}px;align-items:center;justify-content:center;background:#e9f2ff;object-fit:cover`;
    if (u.avatar_url) { avatar.src = u.avatar_url; avatar.alt = u.display_name; } else avatar.textContent = (u.display_name || '?').slice(0, 1);
    swap(el, avatar);
  },
  async 'popular-labels'(el, params, ctx) { await renderLabels(el, params, ctx, true); },
  async listlabels(el, params, ctx) { await renderLabels(el, params, ctx, false); },
  async 'blog-posts'(el, params, ctx) {
    const rows = await report('blog', params, ctx);
    swap(el, rows.length ? listWidget('macro-blog', rows.map(r => navLink(ctx, r.space_key, r.id, r.title))) : emptyWidget('블로그 글 없음'));
  },
  attachments(el, params, ctx) {
    let rows;
    try { rows = selectAttachments(ctx.page.attachments ?? [], params); }
    catch { swap(el, emptyWidget('첨부 패턴이 올바르지 않습니다')); return; }
    // 파일 카드에 크기가 이미 있으므로 따로 크기 열을 두지 않는다
    swap(el, rows.length ? tableWidget(['파일', '버전'], rows.map(r => [fileCard({ filename: r.filename, meta: r, url: `/api/att/${ctx.page.id}/${encodeURIComponent(r.filename)}` }), r.version ? `v${r.version}` : ''])) : emptyWidget('첨부 파일 없음'));
  },
  'toc-zone'(el, params, ctx) {
    const body = el.querySelector(':scope > div[style]');
    if (!body) return;
    body.style.display = '';
    const heads = [...body.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(h => Number(h.tagName[1]) >= (Number(params.minLevel) || 1) && Number(h.tagName[1]) <= (Number(params.maxLevel) || 6));
    // 범위 안에 제목이 없으면(직접 쓴 링크 목록 등) 본문만 보여 준다 — 빈 목차 안내를 띄우지 않음
    if (!heads.length) { el.querySelector('.macro-badge')?.remove(); return; }
    const nav = createToc(heads.map((h, i) => {
      if (!h.id) h.id = `zone-${ctx.page.id}-${Math.random().toString(36).slice(2)}-${i}`;
      return { level: Number(h.tagName[1]), text: h.textContent, href: `#${h.id}`, scroll: () => h.scrollIntoView({ behavior: 'smooth' }) };
    }));
    swap(el, nav);
    if (params.location === 'bottom') el.append(nav);
    else if (params.location === 'both') el.append(nav.cloneNode(true));
  },
  async 'native-embed:page'(el, params, ctx) {
    const url = typeof params.url === 'object' ? params.url['ri:value'] : params.url;
    const id = /\/pages\/(\d+)/.exec(url ?? '')?.[1] ?? /[?&]pageId=(\d+)/.exec(url ?? '')?.[1];
    if (!id) { swap(el, emptyWidget('대상 문서를 찾을 수 없습니다')); return; }
    try { await includePage(el, { ...params, targetId: id }, ctx, false); }
    catch {
      // 대상 문서가 아직 이관되지 않음 — 주소로 열면 Gonfluence가 이관된 문서 또는 원본으로 보낸다
      const box = emptyWidget('포함된 문서가 아직 이관되지 않았습니다 ');
      const a = document.createElement('a'); a.href = `/wiki/pages/viewpage.action?pageId=${id}`; a.target = '_blank'; a.rel = 'noreferrer'; a.textContent = '문서 열기';
      box.append(a); swap(el, box);
    }
  },
  async 'recently-updated-dashboard'(el, params, ctx) {
    const rows = await report('recent', { ...params, max: params.max || 10 }, ctx);
    swap(el, listWidget('macro-recent', rows.map(r => [navLink(ctx, r.space_key, r.id, r.title), ` — ${r.author_name ?? ''} ${fmtDate(r.updated_at)}`])));
  },
  async index(el, params, ctx) {
    const rows = await report('index', params, ctx);
    swap(el, listWidget('macro-index', rows.map(r => navLink(ctx, r.space_key, r.id, r.title))));
  },
  async 'create-from-template'(el, params, ctx) {
    const button = document.createElement('button');
    button.className = 'btn btn-sm';
    button.textContent = params.buttonLabel ?? params.createButtonLabel ?? '만들기';
    button.disabled = true;
    button.title = '템플릿 확인 중';
    swap(el, button);
    const key = macroSpaceKey(params) ?? ctx.page.spaceKey;
    const base = `/api/spaces/${encodeURIComponent(key)}/templates`;
    let templates;
    try { templates = await api(base); }
    catch { button.title = '템플릿을 조회할 수 없습니다'; return; }
    const id = templateId(params, new Set(templates.map((t) => String(t.id))));
    if (!id) {
      button.title = '원본 템플릿이 이관되지 않음'; return;
    }
    button.disabled = false;
    button.title = '';
    button.onclick = async () => {
      button.disabled = true;
      try {
        const result = await api(`${base}/${encodeURIComponent(id)}/create`, { method: 'POST',
          json: { parentId: ctx.page.id, title: params.title } });
        ctx.navigate(`/s/${encodeURIComponent(key)}/p/${result.id}/edit`);
      } catch (e) { alert(e.message); button.disabled = false; }
    };
  },
  async jirachart(el, params) {
    const box = document.createElement('div');
    box.className = 'macro-jirachart';
    box.style.overflowX = 'auto';
    box.textContent = 'Jira 차트 불러오는 중…';
    swap(el, box);
    try {
      const data = await api(`/api/gira/stats?${chartQuery(params)}`);
      box.innerHTML = renderChart(data, params);
    } catch (error) { box.textContent = `Jira 차트를 표시할 수 없습니다: ${error.message}`; }
  },
  // 목차: 같은 본문의 제목들로 생성 (링크는 스크롤 이동)
  toc(el, params, ctx) {
    const doc = el.closest('.doc');
    if (!doc) return;
    const heads = [...doc.querySelectorAll('h1, h2, h3, h4, h5, h6')];
    if (!heads.length) { el.remove(); return; }
    const nav = createToc(heads.map((h, i) => {
      if (!h.id) h.id = `h-${i}-${(h.textContent ?? '').trim().slice(0, 24).replace(/\s+/g, '-')}`;
      return { level: Number(h.tagName[1]), text: h.textContent, href: `#${h.id}`,
        scroll: () => h.scrollIntoView({ behavior: 'smooth', block: 'start' }) };
    }));
    swap(el, nav);
  },

  children(el, params, ctx) {
    const items = (ctx.page.children ?? []).map((ch) => navLink(ctx, ctx.page.spaceKey, ch.id, ch.title));
    if (!items.length) { el.remove(); return; }
    swap(el, listWidget('macro-children', items));
  },

  async pagetree(el, params, ctx) {
    const space = await api(`/api/spaces/${ctx.page.spaceKey}`);
    const byParent = new Map();
    for (const row of space.tree) {
      const k = row.parent_id ?? 'root';
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k).push(row);
    }
    const rootTitle = params.root?.['ri:content-title'];
    const rootRow = rootTitle ? space.tree.find((r) => r.title === rootTitle) : null;
    const build = (parentKey, depth) => {
      const rows = byParent.get(parentKey) ?? [];
      if (!rows.length || depth > 6) return null;
      const ul = document.createElement('ul');
      for (const r of rows) {
        const li = document.createElement('li');
        li.append(r.type === 'folder' ? `📁 ${r.title}` : navLink(ctx, ctx.page.spaceKey, r.id, r.title));
        const sub = build(r.id, depth + 1);
        if (sub) li.append(sub);
        ul.append(li);
      }
      return ul;
    };
    const tree = build(rootRow ? rootRow.id : (space.homepage_id ?? 'root'), 0)
      ?? build('root', 0);
    if (!tree) { el.remove(); return; }
    const div = document.createElement('div');
    div.className = 'macro-pagetree';
    div.append(tree);
    swap(el, div);
  },

  'view-file'(el, params, ctx) {
    const info = attInfo(ctx, params);
    if (!info) return;
    const type = info.meta?.media_type ?? '';
    if (type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = info.url; img.alt = info.filename; img.className = 'macro-view-image';
      swap(el, img);
    } else if (type === 'application/pdf' || /\.pdf$/i.test(info.filename)) {
      HANDLERS.viewpdf(el, params, ctx);
    } else {
      swap(el, fileCard(info));
    }
  },

  // PDF는 파일 카드로만 두고, 누르면 새 탭에서 브라우저 내장 뷰어로 연다.
  // (좁은 표 셀 안에 인라인 iframe/버튼을 두면 레이아웃이 깨져 미리보기가 겹쳐 보였다)
  viewpdf(el, params, ctx) {
    const info = attInfo(ctx, params);
    if (!info) return;
    swap(el, fileCard(info, { open: true }));
  },

  viewdoc(el, params, ctx) { const i = attInfo(ctx, params); if (i) swap(el, fileCard(i)); },
  viewxls(el, params, ctx) { const i = attInfo(ctx, params); if (i) swap(el, fileCard(i)); },
  viewppt(el, params, ctx) { const i = attInfo(ctx, params); if (i) swap(el, fileCard(i)); },

  widget(el, params) {
    const url = params.url?.['ri:value'];
    if (!url) return;
    const yt = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/.exec(url);
    if (yt) {
      const frame = document.createElement('iframe');
      frame.className = 'macro-widget-embed';
      frame.src = `https://www.youtube.com/embed/${yt[1]}`;
      frame.allowFullscreen = true;
      swap(el, frame);
    } else {
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noreferrer';
      a.textContent = `🔗 ${url}`;
      swap(el, a);
    }
  },

  async profile(el, params) {
    const accountId = params.user?.['ri:userkey'] ?? params.user?.['ri:account-id'];
    if (!accountId) return;
    const chip = document.createElement('span');
    chip.className = 'mention';
    try {
      const u = await api(`/api/users/${encodeURIComponent(accountId)}`);
      chip.textContent = `@${u.display_name ?? '(알 수 없는 사용자)'}`;
    } catch { chip.textContent = '@(알 수 없는 사용자)'; }
    swap(el, chip);
  },

  async contributors(el, params, ctx) {
    const versions = await api(`/api/content/${ctx.page.id}/versions`);
    const names = [...new Set(versions.map((v) => v.author_name).filter(Boolean))];
    const limit = Number(params.limit) || names.length;
    const div = document.createElement('span');
    div.className = 'macro-contributors';
    div.textContent = names.slice(0, limit).join(', ');
    swap(el, div);
  },

  async 'recently-updated'(el, params, ctx) {
    const rows = await api(`/api/spaces/${ctx.page.spaceKey}/recent?limit=${Number(params.max) || 5}`);
    swap(el, listWidget('macro-recent', rows.map((r) => [
      navLink(ctx, ctx.page.spaceKey, r.id, r.title),
      Object.assign(document.createElement('span'), { className: 'muted', textContent: ` — ${r.author_name ?? ''} ${fmtDate(r.updated_at)}` }),
    ])));
  },

  async contentbylabel(el, params, ctx) {
    const labels = params.labels ?? params.label ?? '';
    const space = params.spaces?.['ri:space-key'] ?? params.spaces ?? '';
    const rows = await api(`/api/label-content?label=${encodeURIComponent(labels)}&space=${encodeURIComponent(typeof space === 'string' ? space : '')}&max=${Number(params.max) || 10}`);
    if (!rows.length) { el.remove(); return; }
    swap(el, listWidget('macro-labelled', rows.map((r) => navLink(ctx, r.space_key, r.id, r.title))));
  },

  // 대상 문서가 아직 이관되지 않았으면(제목으로 못 찾음) 배지 대신 안내 — 원본 제목은 남긴다
  async include(el, params, ctx) { try { await includePage(el, params, ctx, false); } catch { swap(el, missingInclude(params)); } },
  async 'excerpt-include'(el, params, ctx) { try { await includePage(el, params, ctx, true); } catch { swap(el, missingInclude(params)); } },

  drawio(el, params, ctx) {
    const name = params.diagramName;
    if (!name) return;
    const preview = ctx.page.attachments?.find((a) => a.filename === `${name}.png`)
      ?? ctx.page.attachments?.find((a) => a.filename === name && a.media_type?.startsWith('image/'));
    if (!preview) return; // 미리보기 없으면 배지 유지
    const img = document.createElement('img');
    img.src = `/api/att/${ctx.page.id}/${encodeURIComponent(preview.filename)}`;
    img.alt = name; img.className = 'macro-view-image';
    if (params.diagramWidth) img.style.maxWidth = `${params.diagramWidth}px`;
    swap(el, img);
  },
  // 페이지 트리 검색 (개인 스페이스 기본 홈 'Navigate space'): 입력 + 검색 → 이 스페이스 범위 검색 화면 (GIRA-53)
  pagetreesearch(el, params, ctx) {
    const space = macroSpaceKey(params) ?? ctx.page.spaceKey;
    const form = document.createElement('form');
    form.className = 'macro-search macro-search-tree';
    form.innerHTML = '<input type="search" aria-label="스페이스 검색"><button type="submit">검색</button>';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = form.querySelector('input').value.trim();
      if (q) ctx.navigate(`/search?q=${encodeURIComponent(q)}${space ? `&space=${encodeURIComponent(space)}` : ''}`);
    });
    swap(el, form);
  },
  // 실시간 검색: 입력하면 결과(제목·발췌)를 아래에 펼친다. spaceKey가 있으면 그 스페이스만 (GIRA-53)
  livesearch(el, params, ctx) {
    const space = macroSpaceKey(params);
    const box = document.createElement('div');
    box.className = `macro-search macro-livesearch${params.size === 'large' ? ' large' : ''}`;
    box.innerHTML = '<input type="search" aria-label="실시간 검색"><ul class="macro-livesearch-results" hidden></ul>';
    const input = box.querySelector('input');
    const list = box.querySelector('ul');
    input.placeholder = typeof params.placeholder === 'string' && params.placeholder ? params.placeholder : '검색';
    const withExcerpt = /excerpt/.test(String(params.additional ?? ''));
    let timer = null, seq = 0;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = input.value.trim();
        const my = ++seq;
        if (!q) { list.hidden = true; list.replaceChildren(); return; }
        let res;
        try { res = await api(`/api/search?q=${encodeURIComponent(q)}${space ? `&space=${encodeURIComponent(space)}` : ''}`); } catch { return; }
        if (my !== seq) return; // 늦게 온 이전 응답 무시
        const items = (res.hits ?? []).slice(0, 10).map((h) => {
          const li = document.createElement('li');
          li.append(navLink(ctx, h.spaceKey, h.id, h.title));
          if (withExcerpt && h.excerpts?.[0]) {
            const p = document.createElement('div');
            p.className = 'muted macro-livesearch-excerpt';
            p.innerHTML = highlightOnly(h.excerpts[0]);
            li.append(p);
          }
          return li;
        });
        if (!items.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = '결과가 없습니다'; items.push(li); }
        list.replaceChildren(...items);
        list.hidden = false;
      }, 250);
    });
    swap(el, box);
  },
};

// 매크로 파라미터의 스페이스 키 (ri:space 참조 또는 문자열)
function macroSpaceKey(params) {
  const v = params.spaceKey ?? params.spaces;
  if (v && typeof v === 'object') return v['ri:space-key'] || null;
  return typeof v === 'string' && v.trim() && !/^@/.test(v.trim()) ? v.trim() : null;
}
// 검색 발췌 강조: <em>만 살리고 나머지는 글자로
function highlightOnly(html) {
  const esc = String(html).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/&lt;em&gt;/g, '<em>').replace(/&lt;\/em&gt;/g, '</em>');
}

function missingInclude(params) {
  const ref = params[''] ?? params.page ?? {};
  const div = document.createElement('div');
  div.className = 'muted';
  div.textContent = `포함된 문서 '${ref['ri:content-title'] ?? '(제목 없음)'}'가 아직 이관되지 않았습니다`;
  return div;
}

async function includePage(el, params, ctx, excerptOnly) {
  const ref = params[''] ?? params.page ?? {};
  const title = ref['ri:content-title'];
  if (!title && !params.targetId) return;
  const spaceKey = ref['ri:space-key'] ?? ctx.page.spaceKey;
  const { id, spaceKey: realKey } = params.targetId ? { id: params.targetId, spaceKey } : await api(`/api/resolve?title=${encodeURIComponent(title)}&spaceKey=${encodeURIComponent(spaceKey)}`);
  const ancestors = ctx.includeAncestors ?? [String(ctx.page.id)];
  if (ancestors.includes(String(id)) || ancestors.length >= 8) { swap(el, emptyWidget('순환 문서 포함')); return; }
  const target = await api(`/api/content/${id}`);
  let doc = target.version?.doc;
  if (!doc) return;
  if (excerptOnly) {
    const found = findNode(doc, (n) => n.type === 'cfMacro' && n.attrs?.name === 'excerpt');
    if (!found?.content) return;
    doc = { type: 'doc', content: found.content };
  }
  const box = document.createElement('div');
  box.className = 'macro-include';
  if (!excerptOnly || params.nopanel !== 'true') {
    const head = document.createElement('div');
    head.className = 'macro-include-head';
    head.append('📄 ', navLink(ctx, target.spaceKey ?? realKey, id, target.title));
    box.append(head);
  }
  const body = document.createElement('div');
  body.className = 'doc';
  body.innerHTML = generateHTML(hydrateDoc(structuredClone(doc), id), extensions);
  box.append(body);
  swap(el, box);
  // 포함된 본문 속 매크로도 대상 페이지 컨텍스트로 채운다
  hydrateMacros(body, { ...ctx, page: target, includeAncestors: [...ancestors, String(id)] });
}

function findNode(node, pred) {
  if (pred(node)) return node;
  for (const c of node.content ?? []) { const r = findNode(c, pred); if (r) return r; }
  return null;
}

async function renderLabels(el, params, ctx, popular) {
  let rows = await report('labels', params, ctx);
  rows.sort((a, b) => popular ? b.count - a.count || a.name.localeCompare(b.name, 'ko') : a.name.localeCompare(b.name, 'ko'));
  if (popular) rows = rows.slice(0, Math.max(1, Number(params.count) || 10));
  if (!rows.length) { swap(el, emptyWidget('레이블 없음')); return; }
  // 레이블 버튼 목록 — 누르면 그 레이블 문서들을 아래에 펼친다
  const box = document.createElement('div');
  const results = document.createElement('div');
  const show = async (name) => {
    const pages = await report('content', { ...params, labels: name }, ctx);
    results.replaceChildren(listWidget('macro-labelled', pages.map(r => navLink(ctx, r.space_key, r.id, r.title))));
  };
  box.append(listWidget('macro-labels', rows.map(r => {
    const button = document.createElement('button'); button.className = 'btn btn-sm'; button.textContent = `${r.name} (${r.count})`;
    button.onclick = () => show(r.name); return button;
  })), results);
  swap(el, box);
}
