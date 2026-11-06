# Gira · Gonfluence

Jira·Confluence Cloud를 대체하는 사내 협업 도구.

| 앱 | 하는 일 | 포트 | 서버 | DB |
|---|---|---|---|---|
| **Gonfluence** | 문서 위키 (Confluence 대체) | 3001 | `server/src/index.mjs` | `DATABASE_URL` (rea) |
| **Gira** | 이슈 관리 (Jira 대체) | 3002 | `server/src/jira-viewer.mjs` | `GIRA_DATABASE_URL` (gira) |
| 관리 서비스 | 사용자·팀·그룹 관리 | 3003 | `server/src/admin-app.mjs` | 조직 테이블의 유일한 작성자, 다른 앱 DB로 복제 |

원본 Jira/Confluence에서 데이터를 가져와(읽기 전용 GET) 그대로 보여 주고, 이후에는 자체 편집·이슈 처리를 한다.
원본 → Gira/Gonfluence 동기화는 단방향이며 매일 03:00(KST)에 증분으로 돈다.

## 구성

```
server/   Fastify API — 앱 서버 3개, 권한·알림·AI 도움말·변환·동기화
web/      React SPA — Gonfluence(web/src), Gira(web/src/jira), 관리(admin)
scripts/  임포터·변환기(convert-storage.mjs)·재변환·동기화·명세 동기화·개발 디스패처
docker/   Dockerfile, 개발/배포 compose
docs/     명세 사본(alpha-spec.md)·배포·개발 환경·데이터 모델 등
```

## 빠른 시작 (로컬)

```bash
cp .env.example .env                      # Atlassian 토큰, DB 주소 등 (비밀 값은 .env에만)
docker compose -f docker/docker-compose.dev.yml up -d   # PostgreSQL 16 + OpenSearch
npm install
npm --workspace web run build             # Gonfluence → web/dist   (빌드 후 3001 재시작 필요)
npm --workspace web run build:jira        # Gira       → web/dist-jira-app
npm --workspace web run build:admin       # 관리       → web/dist-admin
node server/src/index.mjs                 # Gonfluence :3001
node server/src/jira-viewer.mjs           # Gira       :3002
node server/src/admin-app.mjs             # 관리       :3003
```

개발 모드: `npm --workspace web run dev` (Gonfluence, 5173) · `npm --workspace web run dev:jira` (Gira, 5174)

## 자주 쓰는 명령

| 명령 | 용도 |
|---|---|
| `npm --workspace web run check` | 모든 문서 버전을 편집기 스키마로 직렬화 검사 (render-check) |
| `node --test server/test/*.test.mjs web/test/*.test.mjs` | 단위 테스트 |
| `node scripts/reconvert.mjs [--dry-run]` | 변환기 수정 후 전 버전에 소급 적용 (원본 재호출 없음) |
| `node scripts/source-sync.mjs --app gira\|gonfluence` | 원본 동기화 수동 실행 |
| `node scripts/spec-sync.mjs --pull\|--push` | 개발 명세서 (원본: Gonfluence GIRA › 개발문서) ↔ `docs/alpha-spec.md` |
| `node scripts/gira-issue.mjs <KEY>` | GIRA 개발 이슈 읽기·상태·댓글 |
| `node scripts/dev-dispatcher.mjs --run --issue <KEY>` | 이슈를 codex 헤드리스로 처리 (별도 worktree, 커밋·푸시까지) |

## 작업 규칙

- 기능은 `feature/<이름>` 브랜치에서, 머지는 검토 후. 커밋 메시지는 한국어.
- 원본 Jira/Confluence API는 **읽기(GET)만**. 실제 이관 문서로 기능 테스트하지 않는다 — 임시 문서를 만들고 지운다.
- 자세한 규칙: `CLAUDE.md` · 배포: `docs/deploy-alpha.md` · 개발 환경: `docs/dev-setup.md`
- 개발 명세서 원본은 Gonfluence 문서이고, `docs/alpha-spec.md`는 사본이다.
