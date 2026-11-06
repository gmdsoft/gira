import { hydrateIssueCard } from './issue-card.js';
// 매크로 하이드레이터: 렌더된 본문의 .cf-macro-slot[data-macro]를 실데이터 위젯으로 교체한다.
// ctx = { page, navigate } — page는 /api/content/:id 응답(attachments·children 포함).
import { generateHTML } from '@tiptap/html';
import { extensions } from './extensions.js';
import { api, hydrateDoc } from './api.js';

export function hydrateMacros(root, ctx) {
  if (!root) return;
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

const HANDLERS = {
  // 목차: 같은 본문의 제목들로 생성 (링크는 스크롤 이동)
  toc(el, params, ctx) {
    const doc = el.closest('.doc');
    if (!doc) return;
    const heads = [...doc.querySelectorAll('h1, h2, h3, h4, h5, h6')];
    if (!heads.length) { el.remove(); return; }
    const nav = document.createElement('nav');
    nav.className = 'macro-toc';
    const ul = document.createElement('ul');
    heads.forEach((h, i) => {
      if (!h.id) h.id = `h-${i}-${(h.textContent ?? '').trim().slice(0, 24).replace(/\s+/g, '-')}`;
      const li = document.createElement('li');
      li.style.marginLeft = `${(Number(h.tagName[1]) - 1) * 16}px`;
      const a = document.createElement('a');
      a.href = `#${h.id}`;
      a.textContent = h.textContent;
      a.addEventListener('click', (e) => { e.preventDefault(); h.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      li.append(a); ul.append(li);
    });
    nav.append(ul);
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

  async include(el, params, ctx) { await includePage(el, params, ctx, false); },
  async 'excerpt-include'(el, params, ctx) { await includePage(el, params, ctx, true); },

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
};

async function includePage(el, params, ctx, excerptOnly) {
  const ref = params[''] ?? params.page ?? {};
  const title = ref['ri:content-title'];
  if (!title) return;
  const spaceKey = ref['ri:space-key'] ?? ctx.page.spaceKey;
  const { id, spaceKey: realKey } = await api(`/api/resolve?title=${encodeURIComponent(title)}&spaceKey=${encodeURIComponent(spaceKey)}`);
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
    head.append('📄 ', navLink(ctx, realKey, id, target.title));
    box.append(head);
  }
  const body = document.createElement('div');
  body.className = 'doc';
  body.innerHTML = generateHTML(hydrateDoc(structuredClone(doc), id), extensions);
  box.append(body);
  swap(el, box);
  // 포함된 본문 속 매크로도 대상 페이지 컨텍스트로 채운다
  hydrateMacros(body, { ...ctx, page: target });
}

function findNode(node, pred) {
  if (pred(node)) return node;
  for (const c of node.content ?? []) { const r = findNode(c, pred); if (r) return r; }
  return null;
}
