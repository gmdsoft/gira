import React, { useEffect, useMemo, useState } from 'react';

const TYPE_ICON = { folder: '📁', whiteboard: '🖊️', database: '🗄️', embed: '🔗', live: '⚡' };

export default function Tree({ tree, spaceKey, currentId, navigate, onMove }) {
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

  return (
    <nav className="tree">
      {roots.map((n) => (
        <TreeNode key={n.id} node={n} children={children} spaceKey={spaceKey} currentId={currentId}
          navigate={navigate} onMove={onMove} depth={0} />
      ))}
    </nav>
  );
}

function TreeNode({ node, children, spaceKey, currentId, navigate, onMove, depth }) {
  const kids = children.get(String(node.id)) ?? [];
  const isCurrent = String(node.id) === String(currentId);
  const [open, setOpen] = useState(depth < 1 || isCurrent || hasDescendant(node, children, currentId));
  const [menu, setMenu] = useState(false);

  // 현재 페이지로 이동하면 그 노드와 조상을 자동으로 펼친다
  useEffect(() => {
    if (isCurrent || hasDescendant(node, children, currentId)) setOpen(true);
  }, [currentId]);
  const icon = TYPE_ICON[node.type];
  const navigable = node.type === 'page' || node.type === 'live';

  return (
    <div className="tree-node" style={{ '--depth': depth }}>
      <div className={`tree-row ${isCurrent ? 'current' : ''} ${menu ? 'menu-open' : ''}`}>
        {kids.length > 0
          ? <button className="tree-toggle" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'}</button>
          : <span className="tree-toggle" />}
        {navigable ? (
          <a href={`/s/${spaceKey}/p/${node.id}`}
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
          navigate={navigate} onMove={onMove} depth={depth + 1} />
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
