# 로컬 개발 환경

2026-10-25 기준. PoC 스캐폴드: `server/`(Fastify API) + `web/`(React + TipTap) + PostgreSQL 16(Docker).

## 준비
- Node 22, Docker + compose v2 (`sudo apt install docker.io docker-compose-v2 docker-buildx`)
- `.env`: `.env.example` 참고 (Atlassian 토큰 + `DATABASE_URL`)

## 실행
```bash
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL 16 (포트 5432)
npm install
node scripts/import-space.mjs --space Research    # 스페이스 임포트 (읽기 전용 GET, 최신 버전만)
npm --workspace web run build                     # SPA 빌드 → web/dist
node server/src/index.mjs                         # API + SPA 서빙 (포트 3001)
```
- 개발 중 웹 핫리로드: `npm --workspace web run dev` (5173, /api·/wiki 는 3001로 프록시)
- 같은 네트워크에서 접속: `http://172.21.1.1:3001`

## 검증 도구
- `npm --workspace web run check` — DB의 모든 본문 doc을 TipTap 스키마로 직렬화(스키마 누락 탐지). 2026-10-25: Research 181/181 성공
- 레거시 URL 호환 확인:
  - `curl -I 'localhost:3001/wiki/pages/viewpage.action?pageId={id}'` → 301
  - `curl -I 'localhost:3001/wiki/x/{token}'` → 301 (단축 링크 디코딩)

## 구성 요소
| 경로 | 내용 |
|---|---|
| `server/src/schema.sql` | docs/data-model.md의 PostgreSQL 스키마 |
| `server/src/index.mjs` | API: 스페이스/트리/본문/댓글/resolve, 첨부 프록시(`/api/att/...`, 원본 Confluence에서 받아 `server/data/att-cache`에 캐시), `/wiki/*` 레거시 리다이렉트, SPA 서빙 |
| `server/src/tinylink.mjs` | `/wiki/x/{token}` ↔ 콘텐츠 ID 인코딩 (실측 검증된 LE base64) |
| `scripts/import-space.mjs` | 스페이스 단위 임포터: 페이지(storage→ProseMirror 변환), 폴더 체인, 첨부 메타, 라벨, 댓글, 사용자 매핑 |
| `web/src/extensions.js` | 변환기 어휘 전체의 TipTap 노드/마크 (render-check에서도 동일 파일 사용) |

## 편집 기능 (2026-10-25 추가)
Confluence와 같은 **초안/게시 분리** 모델.
- `PUT /api/content/:id/draft` — 초안 자동 저장(편집기에서 1.5초 디바운스). `GET`/`DELETE`도 지원
- `POST /api/content/:id/publish` — 초안을 새 버전으로 게시. `baseVersion` 불일치 시 409 (버전 충돌 감지)
- `POST /api/content` — 새 페이지 생성. ID는 `content_id_seq`(이관된 최대 ID보다 크게 서버 기동 시 보정)
- `GET /api/content/:id/versions` — 버전 목록 (`migrated` 플래그로 이관본 구분)
- 웹: `/s/{key}/p/{id}/edit` 편집 라우트, 툴바(제목/굵게/목록/표/패널/펼치기/실행취소), 사이드바 `+ 새 페이지`
- 작성자는 인증 도입 전까지 `개발 모드 사용자`로 기록

## 검색 (2026-10-25 추가)
- OpenSearch 2.19 + **nori**(한국어 형태소) 커스텀 이미지: `search/Dockerfile`, compose의 `search` 서비스(포트 9200)
- 색인: `node scripts/index-search.mjs` (일괄), 게시·복원 시 자동 재색인 (`server/src/search.mjs`)
- API `GET /api/search?q=&space=&type=` — title^3·text·labels 매칭, `<mark>` 하이라이트
- 웹: 홈·사이드바 검색창 → `/search` 결과 화면 (스페이스 필터)
- 검색 엔진이 꺼져 있어도 본 서비스는 동작한다 (색인 실패는 로그만)

## 버전 이력 (2026-10-25 추가)
- `scripts/import-versions.mjs --space KEY` — 과거 버전 전체를 v1 historical API로 수집·변환 (세 스페이스 3,206개 버전 적재, 변환 실패 0)
- API: `GET /api/content/:id/versions/:v`(특정 버전 본문), `POST /api/content/:id/restore`(새 버전으로 복원)
- 웹: `/s/{key}/p/{id}/history` — 버전 목록(작성자·일시·이관 배지), 버전 보기, **현재 버전과 나란히 비교**, 복원

## 편집기 고도화 (2026-10-25 추가)
- 표: 공식 `@tiptap/extension-table`로 교체 — 행/열 추가·삭제, 헤더 토글, 셀 선택 (표 안에 커서가 있을 때 툴바에 조작 버튼 노출)
- **이미지·파일 업로드**: 툴바 버튼, 붙여넣기, 드래그&드롭 → `POST /api/content/:id/attachments` (로컬 저장, 운영 전환 시 MinIO) → 이미지는 media, 그 외는 fileLink로 삽입
- **`/` 명령 메뉴**: `web/src/slash-menu.js` — 제목, 목록, 작업 항목, 표, 패널, 펼치기, 코드, 이미지, 날짜, 상태 등 16종

## 페이지 메뉴 (2026-10-26 추가)
페이지 상단 `⋯` 메뉴 — Confluence의 자주 쓰는 항목을 복원.
- **프레젠테이션 모드**: 제목 슬라이드 + 제목1·2 단위로 본문을 분할, 전체 화면·방향키 넘김 (`web/src/Presentation.jsx`)
- **링크 복사**, **복사본 만들기**(`POST /api/content/:id/copy` — 본문·첨부 메타·캐시 복제), **이동**(`POST /api/content/:id/move` — 스페이스 간 이동 시 하위 트리 동반, 순환 방지)
- **보관/휴지통/복원**: `POST /api/content/:id/status` (하위 트리 전체 적용, 색인 제거·복구). 사이드바 "보관함 · 휴지통"(`/s/{key}/archive`)에서 복원
- **댓글 작성**: 페이지 하단 입력창 → `POST /api/content/:id/comments` (텍스트 → 문단 doc)
- **레이블 추가/삭제**: 헤더에서 바로 편집 → `POST /api/content/:id/labels` (색인 반영)
- 이동 대화상자의 제목 검색은 `GET /api/pages?space=&q=` (DB ILIKE — 검색 엔진과 무관)

## 폭 충실도 (2026-10-26 추가)
원본과 레이아웃 폭이 다르던 문제의 수정.
- 변환기: 표의 `data-table-width`(px)·`data-layout`·colgroup 열 너비(px/%) → table 노드 attrs(tableWidth/layout/colwidths), 이미지의 `ac:custom-width`/`ac:original-width`(width 대체값)·`ac:layout`·`ac:border` 수집
- 렌더러: Confluence와 동일하게 "공간이 있으면 지정 폭, 좁으면 열 비율 유지하며 스크롤 없이 축소" — px 열 너비는 렌더링 시 %로 환산(고정 레이아웃에서 px 열 합계는 표 폭의 하한이라 축소가 안 되기 때문), `width + max-width:100%` 인라인 적용. 편집 모드에서도 속성 보존
- 페이지 "전체 폭 보기": `content.full_width` 컬럼. **현재 Confluence는 전체 폭이 기본값**(콘텐츠 속성 `content-appearance-published`는 명시 변경 시에만 기록, 실측: 595건 중 fixed-width 0건)이라 기본 true, 속성이 명시적으로 fixed-width일 때만 false. 신규 임포트는 import-space.mjs가 수집, 소급은 `node scripts/import-appearance.mjs`
- **`node scripts/reconvert.mjs [--dry-run]`** — DB에 보관한 source_xhtml로 전 버전 재변환 (API 호출 없음). 변환기를 고치면 이걸로 소급 적용. 2026-10-26: 3,203건 재변환, 실패 0, render-check 3,206/3,206
- 주의: `web/dist` 재빌드 후에는 API 서버도 재시작해야 한다 (정적 라우트가 기동 시점 파일 기준)

## 매크로 렌더링 (2026-10-26 추가)
placeholder로 보이던 매크로 18종을 실데이터로 렌더링 (`web/src/macros.js` 하이드레이터).
- 문서 데이터만으로: toc(본문 제목으로 목차), children, pagetree, contributors, excerpt/details(본문 직접 렌더), decision-list
- 첨부 기반: view-file(이미지는 본문 표시, 그 외 파일 카드), viewpdf·PDF(기본 카드 + "미리보기" 버튼으로 펼침), viewdoc·viewxls·viewppt(파일 카드), drawio(미리보기 PNG)
- 조회 API: profile(`/api/users/:accountId`), recently-updated(`/api/spaces/:key/recent`), contentbylabel(`/api/label-content`)
- include/excerpt-include: 대상 페이지 본문(또는 excerpt 부분)을 그 자리에 렌더. **미이관 스페이스를 가리키면 배지로 남는다** (전 스페이스 이관 후 자동 해소)
- widget: YouTube는 임베드, 그 외 링크

## 버전 diff · 인라인 댓글 (2026-10-26 추가)
- 버전 기록 화면 보기 모드: 선택 버전 / 나란히 비교 / **변경 내용(텍스트)** — 블록 LCS + 변경 블록 단어 하이라이트 (`web/src/diff.js`, 서식 변경은 비표시)
- 본문 텍스트 선택 → 💬 버튼 → 인라인 댓글 작성 (`POST /api/content/:id/comments`, kind=inline, inline_ref=선택 텍스트)
- 인라인 댓글 목록에서 인용 클릭 → 본문 위치로 스크롤·강조, 해결/다시 열기 (`POST /api/comments/:id/resolve`)

## 편집기 모드 (2026-10-26 추가)
편집 화면 우상단 토글 — **문서 저장 형식은 동일**(ProseMirror JSON), UI만 다르다. 선택은 localStorage에 기억.
- **Confluence 모드**: 고정 툴바 (기존)
- **Notion 모드**: 툴바 없음, 텍스트 선택 시 버블 메뉴(B/I/U/S/code/링크/H2), 블록 추가는 `/` 명령

## 새 문서·제목 편집 (2026-10-26 추가)
- `+ 새 페이지`: Confluence처럼 **제목 없이 즉시 생성** → 편집기에서 제목 입력(포커스 자동, Enter로 본문 이동)
- 편집기 상단에 제목 입력란 — 기존 문서 제목도 여기서 수정, **게시 시 반영** (초안에는 drafts.title로 저장)
- 빈 제목은 게시 차단. 게시 전 문서를 "초안 버리기" 하면 휴지통으로
- 게시 후 사이드바 트리 자동 갱신

## 알려진 제약 (PoC)
- 첨부 원본은 MinIO가 아니라 Confluence 프록시+캐시 (minio 이미지 pull 이슈: docker.io·quay.io 모두 401 — 재검토 필요). 업로드 첨부는 `server/data/att-cache`에 로컬 저장
- 버전 비교는 나란히 보기(텍스트 단위 diff 하이라이트는 후순위)
- 동시 편집(Yjs), 인라인 댓글 작성, 인증(Entra) 미구현
- 읽기 렌더링에서 `media`는 문단 안 인라인으로 처리. 스키마 위치 규칙은 편집 고도화 때 재검토
