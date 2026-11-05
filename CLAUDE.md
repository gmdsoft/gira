# 작업 규칙

## 브랜치 전략 (2026-10-26, 사용자 지시)
- **새 기능 작업은 반드시 `feature/<이름>` 브랜치를 만들어 진행한다.**
- 작업이 끝나면 커밋까지만 하고 **머지는 사용자가 결과를 검토하고 머지하라고 지시할 때만** 수행한다.
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
- 개발참여 챗봇(server/src/dev-chat.mjs): 지침은 `server/src/dev-agent/guidelines.md`(시스템 프롬프트),
  처리 에이전트 지침은 `dev-agent/worker.md`. 키는 `.env`의 `ANTHROPIC_API_KEY`.
  이슈 처리는 `scripts/dev-dispatcher.mjs`(codex/opencode 헤드리스, ../gira-work/<KEY> worktree, 커밋까지만) —
  챗봇이 즉시 처리 가능한 이슈를 만들거나 needs-approval이 제거되면 Gira 서버가 자동 실행(`DEV_AUTO_DISPATCH=0`으로 끔).
- `web/dist` 재빌드 후에는 API 서버도 재시작해야 정적 라우트가 갱신된다.
- Jira PoC 웹(React SPA)은 `npm --workspace web run build:jira`(→ web/dist-jira-app, 3002 서버 재시작 불필요).
  개발 모드는 `npm --workspace web run dev:jira` (5174 포트, /api는 3002로 프록시).
- 변환기(scripts/convert-storage.mjs)를 고치면 `node scripts/reconvert.mjs`로 전 버전에 소급 적용 (source_xhtml 보관, API 재호출 불필요).
- 검증: `npm --workspace web run check` (전 버전 doc 스키마 직렬화 검사).
