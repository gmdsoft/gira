# 앱 이미지 — Gonfluence(3001)와 Gira(3002)가 같은 이미지를 쓰고,
# compose의 command 로 어느 서버를 띄울지 정한다. (docker-compose.prod.yml 참고)
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY server server
COPY docs/alpha-spec.md docs/alpha-spec.md
COPY web web
RUN npm --workspace web run build && npm --workspace web run build:jira \
 && npm --workspace web run build:admin \
 && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
# DATA_DIR(첨부/캐시)은 볼륨 마운트 지점으로 고정
ENV DATA_DIR=/data
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/src server/src
COPY --from=build /app/docs/alpha-spec.md docs/alpha-spec.md
COPY --from=build /app/web/dist web/dist
COPY --from=build /app/web/dist-jira-app web/dist-jira-app
COPY --from=build /app/web/dist-admin web/dist-admin
EXPOSE 3001 3002 3003
CMD ["node", "server/src/index.mjs"]
