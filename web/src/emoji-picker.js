export const EMOJIS = [
  ['🙂', 'smile 웃음'], ['😄', 'laugh 큰웃음'], ['😉', 'wink 윙크'], ['😛', 'cheeky 메롱'], ['🙁', 'sad 슬픔'],
  ['👍', 'thumbs-up +1 좋아요'], ['👎', 'thumbs-down -1 싫어요'], ['👏', 'clap 박수'], ['🙏', 'pray 부탁 감사'],
  ['✅', 'check tick 완료 확인'], ['❌', 'cross x 아니오 실패'], ['⚠️', 'warning 경고 주의'], ['❓', 'question 질문'],
  ['ℹ️', 'information info 정보'], ['💡', 'bulb idea 아이디어'], ['🔥', 'fire 불'], ['🎉', 'party tada 축하'],
  ['⭐', 'star 별'], ['❤️', 'heart 하트'], ['🚀', 'rocket 로켓 출시'], ['📌', 'pin 고정'], ['📅', 'calendar 달력 일정'],
  ['📝', 'memo note 메모'], ['📊', 'chart 차트 그래프'], ['📁', 'folder 폴더'], ['🔗', 'link 링크'],
  ['🔴', 'red circle 빨강'], ['🟡', 'yellow circle 노랑'], ['🟢', 'green circle 초록'], ['🔵', 'blue circle 파랑'],
  ['⏰', 'alarm clock 시계 마감'], ['🐛', 'bug 버그'], ['🔒', 'lock 잠금 보안'], ['💬', 'comment 댓글 말풍선'],
];

export const emojiCategory = (_, index) => index < 5 ? '표정' : index < 9 ? '사람' : index < 15 ? '기호' : '사물';
export function createEmojiPicker(choose, initialQuery = '') {
  const root = document.createElement('div'); root.className = 'emoji-picker';
  const search = document.createElement('input'); search.placeholder = '이모지 검색'; search.setAttribute('aria-label', '이모지 검색'); search.value = initialQuery;
  const category = document.createElement('select'); category.setAttribute('aria-label', '이모지 카테고리');
  ['전체', '표정', '사람', '기호', '사물'].forEach(c => { const option = document.createElement('option'); option.textContent = c; category.append(option); });
  const grid = document.createElement('div'); grid.className = 'emoji-grid';
  const draw = () => {
    grid.replaceChildren();
    EMOJIS.forEach((item, i) => {
      if (!item[1].includes(search.value.toLowerCase()) || category.value !== '전체' && emojiCategory(item, i) !== category.value) return;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = item[0]; button.title = item[1];
      button.onmousedown = e => e.preventDefault(); button.onclick = () => choose(item); grid.append(button);
    });
    if (!grid.childElementCount) grid.textContent = '일치하는 이모지 없음';
  };
  search.oninput = category.onchange = draw;
  root.onkeydown = event => {
    const buttons = [...grid.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement);
    if (index >= 0 && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      const offset = { ArrowDown: 6, ArrowUp: -6, ArrowLeft: -1, ArrowRight: 1 }[event.key];
      buttons[(index + offset + buttons.length) % buttons.length]?.focus();
    }
  };
  root.append(search, category, grid); draw();
  root.setQuery = query => { search.value = query; draw(); };
  return root;
}
