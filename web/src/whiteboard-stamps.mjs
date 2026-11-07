// 화이트보드 스탬프 (GIRA-79): 원본 화이트보드 33개에서 실제로 쓰인 스탬프 11종 + 예전 이름.
// 원본 스탬프 그림 대신 같은 뜻의 이모지로 그린다 (보기 SVG·편집기 공통).
export const STAMPS = [
  { key: 'success', emoji: '✅', label: '완료' },
  { key: 'gold-star', emoji: '⭐', label: '별' },
  { key: 'warning', emoji: '⚠️', label: '주의' },
  { key: 'fire', emoji: '🔥', label: '불꽃' },
  { key: 'thumbs-up', emoji: '👍', label: '좋아요' },
  { key: 'error', emoji: '❌', label: '오류' },
  { key: 'question-mark', emoji: '❓', label: '질문' },
  { key: 'rocket', emoji: '🚀', label: '로켓' },
  { key: 'artist', emoji: '🎨', label: '디자인' },
  { key: 'note', emoji: '📝', label: '메모' },
  { key: 'heart', emoji: '❤️', label: '하트' },
];
const ALIAS = { like: 'thumbs-up', question: 'question-mark', star: 'gold-star' };
const BY_KEY = new Map(STAMPS.map((s) => [s.key, s]));

export function stampEmoji(key) {
  return BY_KEY.get(ALIAS[key] ?? key)?.emoji ?? '●';
}
