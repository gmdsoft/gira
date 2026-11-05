#!/usr/bin/env bash
# 일일 GIRA 이슈 처리 — 시스템 cron에서 Claude Code를 헤드리스로 실행한다.
# 절차: server/src/dev-agent/daily-run.md (대상 선별 → 이슈별 worktree에서 구현 → 푸시·PR → 이슈에 결과 기록)
# crontab (서버 시계가 UTC — 19:17 UTC = 04:17 KST, 03:00 원본 동기화 뒤):
#   17 19 * * * /home/pottery/development/claude/rea_confluence/scripts/dev-daily-run.sh
# 로그: logs/dev-daily/<날짜>.log  환경변수: DEV_DAILY_BUDGET_USD(기본 10), DEV_DAILY_MODEL(선택)
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:/usr/bin:/bin"
LOG_DIR="$ROOT/logs/dev-daily"
mkdir -p "$LOG_DIR" "$ROOT/../gira-work"
LOG="$LOG_DIR/$(TZ=Asia/Seoul date +%F).log"

# 겹침 방지: 이전 실행이 아직 돌고 있으면 건너뛴다
exec 9>"$LOG_DIR/.lock"
if ! flock -n 9; then echo "$(date -Is) 이전 실행이 진행 중 — 건너뜀" >>"$LOG"; exit 0; fi

cd "$ROOT" || exit 1
# 무인 실행용 장기 토큰(`claude setup-token`으로 발급)을 .env에 두면 그것으로 로그인한다 — 이 값만 읽는다
TOKEN_LINE="$(grep -E '^CLAUDE_CODE_OAUTH_TOKEN=' .env 2>/dev/null | tail -1)"
[ -n "$TOKEN_LINE" ] && export CLAUDE_CODE_OAUTH_TOKEN="${TOKEN_LINE#CLAUDE_CODE_OAUTH_TOKEN=}"
echo "=== $(TZ=Asia/Seoul date '+%F %T KST') 일일 이슈 처리 시작 ===" >>"$LOG"
PROMPT="[일일 GIRA 이슈 처리 — cron 자동 실행, 사람이 지켜보지 않음]
server/src/dev-agent/daily-run.md 를 읽고 그 절차대로 GIRA 개발 프로젝트의 새 이슈를 확인·처리해줘.
머지와 서버 재시작은 하지 않는다. 질문할 사람이 없으니 판단이 서지 않는 이슈는 댓글로 묻고 건너뛴다.
마지막에 처리 결과 보고(처리한 이슈·PR 링크·건너뛴 이유·사람이 결정할 것)를 출력한다."

timeout 3h claude -p "$PROMPT" \
  --permission-mode auto \
  --add-dir "$ROOT/../gira-work" \
  --max-budget-usd "${DEV_DAILY_BUDGET_USD:-10}" \
  ${DEV_DAILY_MODEL:+--model "$DEV_DAILY_MODEL"} \
  >>"$LOG" 2>&1
echo "=== $(TZ=Asia/Seoul date '+%F %T KST') 종료 (코드 $?) ===" >>"$LOG"
