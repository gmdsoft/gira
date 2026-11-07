# 작업 규칙

## 브랜치 전략 (2026-10-26, 사용자 지시)
- **새 기능 작업은 반드시 `feature/<이름>` 브랜치를 만들어 진행한다.**
- 작업이 끝나면 커밋까지만 하고 **머지는 사용자가 결과를 검토하고 머지하라고 지시할 때만** 수행한다.
- 예외(2026-11-07, 사용자 지시): **개발참여 이슈(`dev-chat`) 자동 처리**는 보고자 검토가 끝나면(완료) 감시기가
  feature 브랜치를 **develop에** 머지·푸시한다. master 머지와 운영 서버 반영은 여전히 사람이 한다.
- 기능 단위로 커밋을 쪼개고, 커밋 메시지는 한국어로 쓴다.

## 데이터 원칙
- Confluence Cloud API 접근은 **읽기 전용(GET)만** 허용. 원본을 변경하는 호출 금지.
- rea 분석 결과는 기능 명세 참고용으로만 사용 — Atlassian 코드/에셋을 복사하지 않는다.
- API 토큰 등 비밀 값은 `.env`(gitignore)에만 둔다.
- 실제 이관된 페이지에는 기능 테스트를 하지 않는다 — 테스트는 전용 테스트 페이지를 만들어 쓰고 끝나면 정리한다.

## 개발 메모
- DB는 앱별로 분리: Gonfluence = `DATABASE_URL`(rea), Gira = `GIRA_DATABASE_URL`(gira).
  스키마도 분리(schema-core.sql 공용 + schema.sql / schema-jira.sql). 운영 배포는 docs/deploy-alpha.md.
- 조직(사용자·팀·그룹) 관리는 관리 서비스(admin-app.mjs, 3003)가 전담 — 조직 테이블의 유일한 작성자,
  `ORG_MIRROR_DATABASE_URL`(콤마 구분)로 다른 앱 DB에 복제. 관리 SPA는 `npm --workspace web run build:admin`(→ dist-admin, 재시작 불필요).
- 개발참여 챗봇(server/src/dev-chat.mjs): 지침은 `server/src/dev-agent/guidelines.md`(시스템 프롬프트). 키는 `.env`의 `ANTHROPIC_API_KEY`.
  챗봇은 이슈 등록(+첨부)까지만 하고, 등록 시 GIRA 프로젝트 기본 담당자에게 할당한다(없으면 미할당).
- **개발참여 이슈 자동 처리** — 절차 `server/src/dev-agent/issue-flow.md`:
  등록 → 분석(정보 부족이면 보고자에게 질문, 명세서 범위 밖이면 기본 담당자에게 승인 요청 메일) → feature/<key> worktree(../gira-work/<KEY>,
  origin/develop 기준)에서 구현·푸시 → 테스트 서버(`scripts/dev-test-server.mjs`, 포트 4100~/4200~) → 검토(보고자 할당·댓글·메일)
  → 보고자 댓글이면 반영 반복 → 완료되면 테스트 서버 중단·develop 머지·푸시.
  감시기 `scripts/dev-watch.sh`(→ dev-watch.mjs, 잠금, 로그 logs/dev-flow/): Gira 서버가 `DEV_FLOW=1`이면 GIRA 이슈 이벤트 때 바로 실행,
  시스템 cron이 5분마다 안전망으로 실행. 분석·구현 단계는 `claude -p` 헤드리스(무인 로그인 `.env`의 `CLAUDE_CODE_OAUTH_TOKEN`).
  상태 확인: `node scripts/dev-watch.mjs --dry`, `node scripts/dev-test-server.mjs list`. 이슈 기록·메일: `scripts/gira-issue.mjs`.
  사람이 직접 처리할 때도 같은 절차를 쓴다. (예전 codex/opencode 디스패처 `scripts/dev-dispatcher.mjs`·`worker.md`는 수동용으로만 남아 있다)
- **개발 명세서 원본은 Gonfluence** (GIRA 스페이스 › 개발문서 › Gira·Gonfluence 알파 명세서, page 1000000000009). 명세 업데이트는 거기서 한다.
  `node scripts/spec-sync.mjs --pull`(원본 → `docs/alpha-spec.md` 사본 + `server/data/alpha-spec.md` 캐시) → 사본 수정 → `--push`(새 버전 게시,
  사본 기준 버전이 원본과 다르면 거부). 챗봇·자동 처리는 캐시를 읽고, 감시기가 하루 한 번 `--cache`로 갱신한다.
  예전 Claude Doc(claude.ai/artifact/RhWSzPu8SU2nTfhEJqHLDY)은 더 이상 갱신하지 않는다.
- `web/dist` 재빌드 후에는 API 서버도 재시작해야 정적 라우트가 갱신된다.
- Jira PoC 웹(React SPA)은 `npm --workspace web run build:jira`(→ web/dist-jira-app, 3002 서버 재시작 불필요).
  개발 모드는 `npm --workspace web run dev:jira` (5174 포트, /api는 3002로 프록시).
- 변환기(scripts/convert-storage.mjs)를 고치면 `node scripts/reconvert.mjs`로 전 버전에 소급 적용 (source_xhtml 보관, API 재호출 불필요).
- 원본 동기화: 원본(Jira/Confluence) → Gira/Gonfluence **단방향**. 각 서버가 매일 `SOURCE_SYNC_AT`(KST, 기본 03:00)에
  `scripts/source-sync.mjs --app gira|gonfluence` 실행 (임포터 `--since` 증분, 원본은 GET만). 상태 `GET /api/source-sync`, 즉시 실행 `POST /api/source-sync/run`(관리자), `SOURCE_SYNC=0`으로 끔.
  로컬 생성 행은 id 1e12 이상(LOCAL_ID_FLOOR)이라 원본 id와 충돌하지 않는다.
- 검증: `npm --workspace web run check` (전 버전 doc 스키마 직렬화 검사).
