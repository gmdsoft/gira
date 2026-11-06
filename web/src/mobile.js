import { useEffect, useState } from 'react';

// 알파 모바일은 보기 전용. CSS와 같은 경계로 회전·창 크기 변경도 반영한다.
export const isMobile = () => window.matchMedia('(max-width: 600px)').matches;
export function useMobile() {
  const [mobile, setMobile] = useState(isMobile);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 600px)');
    const update = () => setMobile(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return mobile;
}
