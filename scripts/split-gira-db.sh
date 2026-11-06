#!/usr/bin/env bash
# Gira DB 분리: 단일 DB(rea)에서 jira_* 테이블과 공용 테이블(users/groups/user_groups/api_keys)을
# 새 DB(gira)로 복사한다. 원본(rea)은 변경하지 않는다 — 검증 후 rea 쪽 jira_* 정리는 별도 작업.
#
# 사용법: scripts/split-gira-db.sh [컨테이너명]
#   기본 컨테이너: rea-confluence-dev-postgres-1 (docker/docker-compose.dev.yml)
#   완료 후 .env 에 GIRA_DATABASE_URL=postgres://rea:rea@localhost:5432/gira 추가하고 3002 재시작.
set -euo pipefail

C=${1:-rea-confluence-dev-postgres-1}
U=rea
SRC=rea
DST=gira

psql_src() { docker exec "$C" psql -U "$U" -d "$SRC" -v ON_ERROR_STOP=1 -tA -c "$1"; }
psql_dst() { docker exec "$C" psql -U "$U" -d "$DST" -v ON_ERROR_STOP=1 -tA -c "$1"; }

# 1) 대상 DB 생성 (이미 있으면 유지)
if [ "$(docker exec "$C" psql -U "$U" -d postgres -tA -c "SELECT 1 FROM pg_database WHERE datname='$DST'")" != "1" ]; then
  docker exec "$C" createdb -U "$U" "$DST"
  echo "DB '$DST' 생성"
fi

# 2) 이미 분리된 적 있으면 중단 (재실행으로 데이터가 섞이지 않도록)
if [ "$(psql_dst "SELECT 1 FROM information_schema.tables WHERE table_name='users' LIMIT 1")" = "1" ]; then
  echo "중단: '$DST' DB에 이미 테이블이 있습니다. 다시 하려면 DROP DATABASE $DST 후 재실행하세요." >&2
  exit 1
fi

# 3) 공용 + jira_* 테이블 복사 (스키마·데이터·시퀀스·인덱스·FK 포함)
echo "복사 중: users, groups, user_groups, api_keys, jira_* ..."
docker exec "$C" sh -c "pg_dump -U $U -d $SRC \
  --table users --table groups --table user_groups --table api_keys \
  --table 'jira_*' | psql -U $U -d $DST -v ON_ERROR_STOP=1 -q"

# 4) 검증: 행 수 비교
for T in users jira_projects jira_issues jira_comments jira_attachments jira_sprints jira_boards jira_filters jira_changelog; do
  A=$(psql_src "SELECT count(*) FROM $T")
  B=$(psql_dst "SELECT count(*) FROM $T")
  if [ "$A" != "$B" ]; then
    echo "불일치: $T  $SRC=$A  $DST=$B" >&2
    exit 1
  fi
  printf '  %-20s %s행\n' "$T" "$B"
done

echo "완료. .env 에 다음을 추가하고 Gira 서버(3002)를 재시작하세요:"
echo "  GIRA_DATABASE_URL=postgres://rea:rea@localhost:5432/$DST"
