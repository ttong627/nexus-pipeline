FROM node:22-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY sql ./sql
COPY src ./src
# 운영 작업(스키마 적용·연계자료 동기화)은 Cloud Run **Job**으로 같은 이미지를 쓴다.
#   scripts 를 빼면 Job 이 MODULE_NOT_FOUND 로 죽는다(2026-08-11 실측).
#   테스트(*.test.mjs)까지 들어오지만 실행되지 않고 용량도 수십 KB라 분리 이득이 없다.
COPY scripts ./scripts

ENV NODE_ENV=production
ENV PORT=8080
CMD ["node", "src/server.js"]
