# 일일 이슈 처리 절차 (개발 세션용)

개발 세션(Claude Code)이 하루 한 번(시스템 cron, 04:17 KST — scripts/dev-daily-run.sh) GIRA 개발 프로젝트의
새 이슈를 확인하고 처리할 때 따르는 절차.
사람이 "GIRA-n 처리해"라고 직접 요청한 경우에도 3~7단계를 그대로 쓴다.
CLAUDE.md의 작업 규칙(브랜치, 데이터 원칙, 테스트 데이터 정리)이 항상 우선한다.

## 1. 대상 고르기

`node scripts/gira-issue.mjs`로 열린 이슈 목록을 본다. 아래를 **모두** 만족하는 이슈만 대상이다.

- 상태가 `해야 할 일` (진행 중·검토는 누군가 다루는 중이므로 건드리지 않는다)
- 레이블에 `needs-approval`, `needs-info`, `agent-running`, `agent-done`, `agent-failed`가 없다
- 레이블이 `agent:human`이 아니고, 유형이 에픽이 아니다 (에픽은 하위 이슈로 처리)

**우선순위 순(Highest → High → Normal → Low), 같으면 키 순서**로 **한 번에 최대 3건**. 대상이 없으면 "처리할 이슈 없음"으로 짧게 보고하고 끝낸다.

## 2. 이슈 읽기와 판단

`node scripts/gira-issue.mjs <KEY>`로 설명·댓글·첨부를 모두 읽는다. 첨부(스크린샷·로그)는 경로를 열어 확인한다.

- 내용이 부족해 무엇을 바꿀지 정할 수 없으면 처리하지 않는다. 필요한 정보를 댓글로 묻고
  `--label +needs-info`를 단다.
- `docs/alpha-spec.md`(개발 명세서) 범위를 넘는 작업인데 `needs-approval`이 없으면 처리하지 않는다.
  이유를 댓글로 남기고 `--label +needs-approval`을 단다.
- 같은 내용이 이미 구현돼 있으면(중복) 근거를 댓글로 남기고 처리하지 않는다. 완료 처리는 사람이 한다.

## 3. 시작 기록

```
node scripts/gira-issue.mjs <KEY> --status "진행 중" --label +agent-running --comment "처리 시작 — 개발 세션, 브랜치 feature/<key>"
```

대상 앱 레이블(`Gira` / `Gonfluence`, 공통이면 둘 다)이 없으면 이때 함께 단다 (예: `--label +agent-running,+Gonfluence`).

## 4. 작업 공간

메인 작업 디렉터리(실행 중인 서버가 쓰는 곳)는 건드리지 않는다. 이슈 전용 worktree에서 작업한다.

```
git fetch origin
git worktree add -b feature/<key> ../gira-work/<KEY> origin/master   # 이미 있으면 재사용
```

## 5. 구현

- 직접 구현한다. 크고 독립적인 작업은 `node scripts/dev-dispatcher.mjs --run --issue <KEY> --executor codex --note "..."`로
  맡겨도 된다(권한상 막히면 직접 한다).
- 변경은 이슈 범위 안에서 최소로. 기존 패턴을 따른다. 로컬 생성 행 id는 1e12 이상 대역(LOCAL_ID_FLOOR).
- 원본 Jira/Confluence는 GET만, Atlassian 코드·에셋 복사 금지, 비밀 값은 `.env`에만.
- 검증: 바꾼 서버 파일 `node --check`, 해당 화면 빌드(`npm --workspace web run build` / `build:jira` / `build:admin`),
  문서 변환 관련이면 `npm --workspace web run check`. 테스트는 전용 테스트 데이터로 하고 끝나면 지운다.
- `spec-update` 레이블이 있으면 `docs/alpha-spec.md`의 해당 부분도 고친다.
- 커밋: 한국어, 첫 줄에 이슈 키 (`GIRA-n: ...`). 기능 단위로.

## 6. 올리기

```
git -C ../gira-work/<KEY> push -u origin feature/<key>
```

PR은 `.env`의 `GITHUB_TOKEN`으로 GitHub API(`POST /repos/gmdsoft/gira/pulls`, base `master`)에 만든다.
실패하면(토큰 권한 등) 비교 링크 `https://github.com/gmdsoft/gira/compare/master...feature/<key>?expand=1`을 쓴다.
**머지·서버 재시작은 하지 않는다** — 사람이 PR을 검토하고 지시한다.

## 7. 결과 기록

성공:
```
node scripts/gira-issue.mjs <KEY> --status 검토 --label +agent-done,-agent-running --comment "처리 완료 — PR 검토 대기
PR: <링크>
변경 요약: …
검증: …
남은 일/주의: …"
```

실패하거나 중간에 멈추면 상태를 `해야 할 일`로 되돌리고 `--label +agent-failed,-agent-running`, 이유를 댓글로 남긴다.

## 8. 보고

마지막에 사용자에게 한국어로 짧게: 처리한 이슈(키·제목·PR 링크·검증 결과), 건너뛴 이슈와 이유,
사람이 결정해야 할 것.
