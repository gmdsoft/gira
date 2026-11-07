import React, { useEffect, useMemo, useRef, useState } from 'react';

const TYPE_ICON = { folder: '📁', whiteboard: '🖊️', database: '🗄️', embed: '🔗', live: '⚡', blogpost: '📰' };

// 끌어 옮기기: 끌고 있는 문서 { id, title, spaceKey, parentId, descendants:Set } — dragover에서는 dataTransfer를
// 읽을 수 없어 모듈 변수로 둔다. 스페이스 이름 줄(GonfShell)도 Tree.dragging()으로 확인한다.
let dragging = null;

export default function Tree({ tree, spaceKey, currentId, navigate, onMove, draggable = false, onDropMove }) {
  const { roots, children } = useMemo(() => {
    const children = new Map();
    const ids = new Set(tree.map((n) => String(n.id)));
    const roots = [];
    for (const n of tree) {
      const pid = n.parent_id != null ? String(n.parent_id) : null;
      if (pid && ids.has(pid)) {
        if (!children.has(pid)) children.set(pid, []);
        children.get(pid).push(n);
      } else {
        roots.push(n);
      }
    }
    return { roots, children };
  }, [tree]);

  const dnd = draggable && onDropMove ? { onDropMove } : null;
  return (
    <nav className="tree">
      {roots.map((n) => (
        <TreeNode key={n.id} node={n} children={children} spaceKey={spaceKey} currentId={currentId}
          navigate={navigate} onMove={onMove} depth={0} dnd={dnd} />
      ))}
    </nav>
  );
}
Tree.dragging = () => dragging;

function descendantsOf(node, children) {
  const out = new Set();
  const stack = [...(children.get(String(node.id)) ?? [])];
  while (stack.length) {
    const n = stack.pop();
    out.add(String(n.id));
    stack.push(...(children.get(String(n.id)) ?? []));
  }
  return out;
}

// el을 담은 가장 가까운 세로 스크롤 영역 안에서, 보이지 않을 때만 가운데쯤으로 옮긴다 (창 전체는 건드리지 않는다)
function revealInScroller(el) {
  if (!el) return;
  let box = el.parentElement;
  while (box && box !== document.body) {
    const oy = getComputedStyle(box).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && box.scrollHeight > box.clientHeight) break;
    box = box.parentElement;
  }
  if (!box || box === document.body) return;
  const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
  if (r.top >= b.top && r.bottom <= b.bottom) return;
  box.scrollTop += r.top - b.top - (b.height - r.height) / 2;
}

function TreeNode({ node, children, spaceKey, currentId, navigate, onMove, depth, dnd }) {
  const kids = children.get(String(node.id)) ?? [];
  const isCurrent = String(node.id) === String(currentId);
  const [open, setOpen] = useState(depth < 1 || isCurrent || hasDescendant(node, children, currentId));
  const [menu, setMenu] = useState(false);
  const [dropOn, setDropOn] = useState(false);

  // 현재 페이지로 이동하면 그 노드와 조상을 자동으로 펼친다
  useEffect(() => {
    if (isCurrent || hasDescendant(node, children, currentId)) setOpen(true);
  }, [currentId]);
  // 현재 문서 줄이 사이드바 화면 밖이면 사이드바를 그 위치로 스크롤한다 (링크·즐겨찾기로 바로 들어온 경우)
  const rowRef = useRef(null);
  useEffect(() => {
    if (!isCurrent) return undefined;
    const t = setTimeout(() => revealInScroller(rowRef.current), 50); // 조상 펼침이 그려진 뒤
    return () => clearTimeout(t);
  }, [isCurrent, currentId]);
  const icon = TYPE_ICON[node.type];
  const navigable = ['page', 'live', 'database', 'whiteboard', 'embed', 'blogpost'].includes(node.type);

  // 놓을 수 있는 곳: 자기 자신, 자기 하위, 지금 부모가 아닌 문서·폴더
  const canDrop = () => dnd && dragging && String(dragging.id) !== String(node.id)
    && !(dragging.spaceKey === spaceKey && dragging.descendants.has(String(node.id)))
    && String(dragging.parentId ?? '') !== String(node.id);
  const dragProps = dnd ? {
    draggable: true,
    onDragStart: (e) => {
      e.stopPropagation();
      dragging = { id: node.id, title: node.title, spaceKey, parentId: node.parent_id, descendants: descendantsOf(node, children) };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', node.title);
    },
    onDragEnd: () => { dragging = null; setDropOn(false); },
    onDragOver: (e) => { if (canDrop()) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setDropOn(true); } },
    onDragLeave: () => setDropOn(false),
    onDrop: (e) => {
      if (!canDrop()) return;
      e.preventDefault(); e.stopPropagation(); setDropOn(false);
      const d = dragging; dragging = null;
      dnd.onDropMove(d, { node });
    },
  } : {};

  return (
    <div className="tree-node" style={{ '--depth': depth }}>
      <div ref={rowRef} className={`tree-row ${isCurrent ? 'current' : ''} ${menu ? 'menu-open' : ''} ${dropOn ? 'drop-on' : ''}`} {...dragProps}>
        {kids.length > 0
          ? <button className="tree-toggle" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'}</button>
          : <span className="tree-toggle" />}
        {navigable ? (
          <a href={`/s/${spaceKey}/p/${node.id}`} draggable={false}
             onClick={(e) => { e.preventDefault(); navigate(`/s/${spaceKey}/p/${node.id}`); }}>
            {icon && <span className="tree-icon">{icon}</span>}{node.title}
          </a>
        ) : (
          <span className="tree-label" onClick={() => kids.length && setOpen(!open)}>
            {icon && <span className="tree-icon">{icon}</span>}{node.title}
          </span>
        )}
        {onMove && (
          <span className="tree-menu-wrap">
            <button className="tree-more" title="문서 메뉴" onClick={() => setMenu((v) => !v)}>⋯</button>
            {menu && <>
              <div className="menu-overlay" onClick={() => setMenu(false)} />
              <div className="page-menu tree-menu">
                <button onClick={() => { setMenu(false); onMove(node); }}>→ 이동</button>
              </div>
            </>}
          </span>
        )}
      </div>
      {open && kids.map((k) => (
        <TreeNode key={k.id} node={k} children={children} spaceKey={spaceKey} currentId={currentId}
          navigate={navigate} onMove={onMove} depth={depth + 1} dnd={dnd} />
      ))}
    </div>
  );
}

function hasDescendant(node, children, targetId) {
  if (!targetId) return false;
  const stack = [...(children.get(String(node.id)) ?? [])];
  while (stack.length) {
    const n = stack.pop();
    if (String(n.id) === String(targetId)) return true;
    stack.push(...(children.get(String(n.id)) ?? []));
  }
  return false;
}
