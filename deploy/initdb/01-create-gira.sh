#!/bin/sh
# postgres 컨테이너 최초 기동 시(빈 볼륨) Gira DB를 함께 만든다.
# 기본 DB(rea = Gonfluence)는 POSTGRES_DB 로 이미 생성됨.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE gira OWNER \"$POSTGRES_USER\""
