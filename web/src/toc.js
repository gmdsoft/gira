// 편집기와 보기 화면에서 공유하는 목차. 제목 텍스트는 HTML로 해석하지 않는다.
export function createToc(headings) {
  const nav = document.createElement('nav');
  nav.className = 'macro-toc';
  nav.setAttribute('aria-label', '목차');
  const ul = document.createElement('ul');
  for (const heading of headings) {
    const li = document.createElement('li');
    li.style.marginLeft = `${(heading.level - 1) * 16}px`;
    const a = document.createElement('a');
    a.href = heading.href;
    a.textContent = heading.text;
    a.addEventListener('click', (event) => { event.preventDefault(); heading.scroll(); });
    li.append(a);
    ul.append(li);
  }
  if (headings.length) nav.append(ul);
  else nav.textContent = '목차: 제목을 추가하면 여기에 표시됩니다.';
  return nav;
}
