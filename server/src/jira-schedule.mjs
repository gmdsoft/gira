// GIRA-71: 기한·시간 추적·영향 버전·환경 — 원본 Jira 필드(fields_raw)에서 꺼내 상세 화면용으로
// 시간 단위는 Jira 기본값: 1d = 8h, 1w = 5d

const UNIT = { w: 5 * 8 * 3600, d: 8 * 3600, h: 3600, m: 60 };

// '1w 2d 3h 30m' → 초. 형식이 틀리면 0
export function parseDuration(text) {
  const s = String(text ?? '').trim().toLowerCase();
  if (!s) return 0;
  let total = 0, rest = s;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*([wdhm])/g)) { total += Number(m[1]) * UNIT[m[2]]; rest = rest.replace(m[0], ''); }
  if (rest.trim()) return 0; // 모르는 글자가 남으면 거부
  return Math.round(total);
}

// 초 → '1d 2h 30m' (Jira 표기)
export function formatDuration(seconds) {
  let n = Math.round(Number(seconds) || 0);
  if (n <= 0) return '0m';
  const out = [];
  for (const [u, sec] of Object.entries(UNIT)) { const q = Math.floor(n / sec); if (q) { out.push(`${q}${u}`); n -= q * sec; } }
  return out.join(' ') || '0m';
}

export function scheduleFields(raw = {}) {
  const tt = raw?.timetracking ?? {};
  const time = {
    original: tt.originalEstimateSeconds ?? raw?.timeoriginalestimate ?? null,
    remaining: tt.remainingEstimateSeconds ?? raw?.timeestimate ?? null,
    spent: tt.timeSpentSeconds ?? raw?.timespent ?? null,
  };
  return {
    affects_versions: (raw?.versions ?? []).map((v) => v?.name).filter(Boolean),
    environment_adf: raw?.environment && typeof raw.environment === 'object' ? raw.environment : null,
    timetracking: Object.values(time).some((v) => v != null) ? time : null,
  };
}
