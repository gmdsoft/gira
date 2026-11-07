#!/usr/bin/env bash
# 개발참여 이슈 자동 처리 — 감시기(scripts/dev-watch.mjs)를 잠금을 잡고 실행한다.
# 실행 계기 두 가지:
#   1) Gira 서버(DEV_FLOW=1)가 GIRA 이슈 등록·댓글·상태 변경 때 바로 실행 (server/src/dev-flow-kick.mjs)
#   2) 시스템 cron 안전망 (놓친 일 처리):  */5 * * * * <develop worktree>/scripts/dev-watch.sh
# 로그: logs/dev-flow/<날짜>.log   절차: server/src/dev-agent/issue-flow.md
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:/usr/bin:/bin"
LOG_DIR="$ROOT/logs/dev-flow"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$(TZ=Asia/Seoul date +%F).log"

# 겹침 방지: 이미 돌고 있으면, 끝난 뒤 한 번 더 돌도록 표시만 남기고 나간다
exec 9>"$LOG_DIR/.lock"
if ! flock -n 9; then touch "$LOG_DIR/.again"; exit 0; fi

cd "$ROOT" || exit 1
# 무인 실행용 장기 토큰(`claude setup-token`)과 운영 데이터 폴더
TOKEN_LINE="$(grep -E '^CLAUDE_CODE_OAUTH_TOKEN=' .env 2>/dev/null | tail -1)"
[ -n "$TOKEN_LINE" ] && export CLAUDE_CODE_OAUTH_TOKEN="${TOKEN_LINE#CLAUDE_CODE_OAUTH_TOKEN=}"
[ -z "${DATA_DIR:-}" ] && [ -e .env ] && export DATA_DIR="$(dirname "$(readlink -f .env)")/server/data"

for i in 1 2 3; do
  rm -f "$LOG_DIR/.again"
  # 명세서 캐시는 하루 한 번만 갱신 (챗봇·처리 에이전트가 읽는다)
  STAMP="$LOG_DIR/.spec-$(TZ=Asia/Seoul date +%F)"
  if [ ! -e "$STAMP" ]; then node scripts/spec-sync.mjs --cache >>"$LOG" 2>&1 && touch "$STAMP"; fi
  node scripts/dev-watch.mjs >>"$LOG" 2>&1
  [ -e "$LOG_DIR/.again" ] || break
done
