# 원본 호환성 조사 도구 (2026-11-06)

원본 Confluence·Jira에서 지금 이관·표시가 안 되는 것을 찾을 때 쓴 도구. 모두 **원본에는 GET만** 한다.
결과·원본 데이터는 `analysis/raw/`(gitignore, 사내 문서 제목 포함)에 둔다. 명세는 '원본 Confluence 호환성'·'원본 Jira 호환성' 절, 이슈는 에픽 GIRA-47·GIRA-61.

| 도구 | 용도 |
| --- | --- |
| `scripts/confluence-fullscan.mjs` | Confluence 전체 본문을 변환기로 돌려 문서별 미지원 매크로·앱 블록 기록 → `analysis/raw/fullscan.json` |
| `scripts/jira-fullscan.mjs` | Jira 전체 이슈(fields=*all) 필드 사용량·ADF 요소·첨부·링크·보안 수준 집계 → `analysis/raw/jira/fullscan.json` |
| `canvas-fetch.mjs` | 데이터베이스·화이트보드 Yjs 스냅샷 받기 → `analysis/raw/canvas/<type>-<id>.ybin` (GIRA-50·58) |
| `canvas-decode.mjs` | .ybin → JSON, `--summary`로 폴더 집계. 데이터 구조 메모는 파일 머리 주석 |
| `whiteboard-svg.mjs` | 화이트보드 → 정적 SVG 시제품 (한계는 머리 주석) |
| `confluence-view-probe.mjs` | 디버그 브라우저로 원본 화면을 열어 스크린샷·호출 API 기록 (클릭 없음) |

로컬 보관물 (이 서버 `analysis/raw/`):

- `canvas/` — 데이터베이스 48·화이트보드 33 스냅샷 전체(.ybin + meta)
- `survey-2026-11-06/` — 매크로별 파라미터 분포(`macro-params.json`), 매크로별 예시 문서(`macro-samples.json`), 집계 요약(Confluence·캔버스·Jira), 원본 화면 캡처(매크로·데이터베이스·화이트보드·임베드)
- `jira/` — 프로젝트 목록, 전수 집계, 엔터티(필터·대시보드·보드·보안) 집계, 원격 링크 표본

작업은 전체 이관이 아니라 **샘플 문서만** 가져와서 한다: Confluence는 `node scripts/import-space.mjs --space KEY --pages id1,id2`(예시 문서 id는 `macro-samples.json`), 데이터베이스·화이트보드는 위 스냅샷.
