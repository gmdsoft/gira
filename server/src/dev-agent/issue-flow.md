# 개발참여 이슈 처리 절차

개발참여 챗봇이 등록한 GIRA 이슈(레이블 `dev-chat`)를 **등록되는 대로 바로** 처리한다.
감시기(`scripts/dev-watch.sh` → `scripts/dev-watch.mjs`)가 할 일을 찾아 단계별로 진행하고,
분석·구현이 필요한 단계는 Claude Code 헤드리스(`claude -p`)에 이슈 하나씩 맡긴다.
사람이 개발 세션에서 "GIRA-n 처리해"라고 직접 요청한 경우에도 3~4단계를 그대로 쓴다.
CLAUDE.md의 작업 규칙(데이터 원칙, 테스트 데이터 정리, 공개 저장소)이 항상 우선한다.

## 1. 흐름 한눈에

```
등록(해야 할 일) ─ 분석 ─┬─ 정보 부족 → 보고자에게 질문(needs-info) → 답 댓글 → 다시 분석
                         ├─ 명세서 범위 밖 → needs-approval → 기본 담당자에게 할당·메일 → 승인(레이블 제거) → 다시 분석
                         └─ 처리 → 구현·커밋·푸시 → 테스트 서버 → 검토(보고자에게 할당·메일)
검토 ─┬─ 보고자 수정 요청 댓글 → 반영 → 테스트 서버 다시 띄움 → 검토 (반복)
      ├─ 보고자 질문 댓글 → 답변 → 검토 유지
      └─ 보고자 "확인/완료" 댓글 또는 보고자가 직접 완료 → 완료
완료 → 테스트 서버 중단 → feature 브랜치를 develop에 머지·푸시 → 기본 담당자에게 '운영 반영 필요' 메일
```

| 단계 | 누가 | 계기 |
| --- | --- | --- |
| request-approval | 감시기 | `needs-approval`이 있고 `approval-requested`가 없음 → 기본 담당자에게 할당·메일(없으면 미할당) |
| process | 에이전트 | 상태 `해야 할 일`, 또는 `needs-info`에 보고자가 답 댓글 |
| revise | 에이전트 | `agent-review`(검토 중)에 사람이 새 댓글 |
| finalize | 감시기 | `agent-review`인 이슈가 완료 분류 상태가 됨 |

건드리지 않는 이슈: `dev-chat`이 아닌 것, `agent:human`, 에픽(하위 이슈로 처리), `agent-running`·`agent-failed`·`merge-conflict`.
`agent-failed`·`merge-conflict`는 관리자가 확인하고 레이블을 지우면 다시 진행된다.

## 2. 도구

- 모든 도구(`scripts/…`)는 **감시기가 실행한 폴더(develop worktree, 처음 작업 디렉터리)에서** 실행한다.
  이슈 worktree에는 `.env`·의존성이 없을 수 있다 — 테스트 서버 도구가 필요할 때 알아서 준비한다.
- 이슈 읽기: `node scripts/gira-issue.mjs <KEY>` (설명·댓글·첨부 경로). 첨부(스크린샷·로그)는 열어 본다.
- 기록: `node scripts/gira-issue.mjs <KEY> [--status 이름] [--label +a,-b] [--assign reporter|agent|none] [--comment "…"]`
- 메일: 같은 명령에 `--mail reporter|approvers --subject "제목" [--note "안내 문장"] [--link "이름|주소"]`
  (대기열에 넣으면 Gira 서버가 보낸다. 보고자에게는 인앱 알림도 남는다. approvers = GIRA 프로젝트 기본 담당자 — 없으면 보내지 않음)
- 테스트 서버: `node scripts/dev-test-server.mjs start <KEY>` (빌드 후 실행·재시작, 주소 출력) / `stop <KEY>` / `list`
- 개발 명세서 최신본: `server/data/alpha-spec.md`(Gonfluence 원본 사본)

## 3. 분석·처리 (process)

감시기가 `agent-running`을 이미 달아 두었다. 어떤 결말이든 **끝낼 때 `-agent-running`을 함께 기록**한다.

1. 이슈를 읽는다. `needs-info`가 있었다면 보고자 답이 온 것이므로 `-needs-info`.
2. 판단한다.
   - **정보 부족**(무엇을 바꿀지 정할 수 없음): 필요한 것을 한 번에 묻는다.
     ```
     node scripts/gira-issue.mjs <KEY> --label +needs-info,-agent-running --assign reporter --comment "확인이 필요합니다: …" \
       --mail reporter --subject "추가 정보 요청" --note "이슈 댓글로 답해 주시면 바로 이어서 처리합니다."
     ```
   - **명세서 범위 밖**이고 `approved` 레이블이 없음(명세서에 없는 새 기능·범위 확대, 정책 변경, 단계 앞당기기, 제약과 충돌):
     ```
     node scripts/gira-issue.mjs <KEY> --label +needs-approval,-agent-running --comment "개발 명세서 범위를 넘어 관리자 승인이 필요합니다: (이유)"
     ```
     메일은 감시기가 보낸다. `approved`가 있으면 관리자가 승인한 것이니 그대로 처리한다(명세서 갱신 필요 → `spec-update`).
   - **이미 구현됨/중복**: 근거(화면 위치·커밋·이슈 키)를 댓글로 남기고 `--status 검토 --assign reporter --label -agent-running --mail reporter --subject "확인 요청"`.
     (테스트 서버 없이 검토 — 보고자가 완료로 바꾸면 끝, `agent-review`를 달지 않으므로 머지 단계 없음)
3. 처리 시작 기록 (대상 앱 레이블 `Gira`/`Gonfluence`가 없으면 함께):
   ```
   node scripts/gira-issue.mjs <KEY> --status "진행 중" --assign agent --comment "처리 시작 — 브랜치 feature/<key>"
   ```
4. 작업 공간: 운영 서버가 도는 develop worktree와 메인 폴더는 건드리지 않는다. 이슈 전용 worktree에서 한다.
   ```
   git fetch origin
   git worktree add -b feature/<key> <작업 폴더>/<KEY> origin/develop   # 작업 폴더 = ../gira-work, 이미 있으면 재사용
   ```
5. 구현: 이슈 범위 안에서 최소로, 기존 패턴을 따른다. 직접 구현한다(dev-dispatcher는 쓰지 않는다 — PR 흐름이 다르다).
   - 원본 Jira/Confluence는 GET만, Atlassian 코드·에셋 복사 금지, 비밀 값은 `.env`에만, 공개 저장소이므로 원본 데이터 커밋 금지.
   - 로컬 생성 행 id는 1e12 이상 대역(LOCAL_ID_FLOOR).
   - 검증: 바꾼 서버 파일 `node --check`, 관련 테스트(`node --test test/<파일>`), 문서 변환 관련이면 `npm --workspace web run check`.
     테스트 서버가 운영 DB를 같이 쓰므로, 기능 확인은 전용 테스트 데이터(제목 `ZZ …`)로 하고 끝나면 지운다.
   - `spec-update`면 `docs/alpha-spec.md` 해당 부분도 고친다(먼저 `node scripts/spec-sync.mjs --pull`). 원본 게시는 사람이 한다.
   - 커밋: 한국어, 첫 줄에 이슈 키(`GIRA-n: …`), 기능 단위.
6. 올리기: `git -C <worktree> push -u origin feature/<key>` (PR은 만들지 않는다 — 보고자 검토가 끝나면 감시기가 develop에 머지한다)
7. 테스트 서버: `node scripts/dev-test-server.mjs start <KEY>` → 출력된 주소를 쓴다. 실패하면 로그를 보고 고친다.
8. 검토 요청 (보고자에게 할당 + 댓글 + 메일):
   ```
   node scripts/gira-issue.mjs <KEY> --status 검토 --assign reporter --label +agent-review,-agent-running \
     --comment "검토요망 — 테스트 서버에서 확인해 주세요.
   테스트 서버: Gonfluence http://… / Gira http://…
   확인 방법: (어느 화면에서 무엇을 하면 되는지 1~3줄)
   변경 요약: …
   검증: …
   수정할 점은 이 이슈에 댓글로 남겨 주세요. 괜찮으면 '확인했습니다'라고 댓글을 달거나 상태를 완료로 바꿔 주세요." \
     --mail reporter --subject "검토 요청" --note "요청하신 내용을 처리했습니다. 테스트 서버에서 확인해 주세요." \
     --link "Gonfluence 테스트 서버|http://…" --link "Gira 테스트 서버|http://…"
   ```
9. 실패하거나 끝낼 수 없으면: `--status "해야 할 일" --label +agent-failed,-agent-running --comment "(이유)"`
   후 `--mail approvers --subject "자동 처리 실패"`.

## 4. 추가 요청 처리 (revise)

검토 중인 이슈에 사람이 새 댓글을 달았다. 마지막 에이전트 댓글 이후의 댓글을 읽고 판단한다.

- **검토 끝("확인했습니다", "좋아요", "완료해 주세요" 등)**:
  `--status 완료 --label -agent-running --comment "검토 완료 확인 — develop에 머지합니다."`
  (`agent-review`는 남긴다 — 감시기가 테스트 서버를 내리고 머지한다)
- **수정 요청**: `--status "진행 중" --assign agent --comment "추가 요청 반영 시작"` → 같은 worktree에서 3단계 5~8을 다시
  (커밋·푸시 → `dev-test-server.mjs start`로 다시 띄움 → 댓글은 "수정 반영 — 다시 검토요망"으로 시작).
- **질문만**: 댓글로 답하고 `--label -agent-running --mail reporter --subject "답변"`. 검토 상태·담당은 그대로.
- **이 이슈 범위를 넘는 새 요청**: 개발참여로 새 이슈를 등록하도록 댓글로 안내(질문과 같이 처리).
- 테스트 서버가 꺼져 있으면(`list`에 '꺼짐') `start`로 다시 띄운다.

## 5. 하지 않는 것

- develop·master 머지, 운영 서버(3001/3002/3003) 빌드·재시작 — 머지는 감시기가, 운영 반영은 관리자가 한다.
- develop worktree·메인 폴더에서 작업하거나 파일을 바꾸는 것.
- 원본 Jira/Confluence 쓰기, 실제 이관된 문서·이슈로 기능 시험, 비밀 값 출력.
