FROM node:22-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY sql ./sql
COPY src ./src

ENV NODE_ENV=production
ENV PORT=8080
CMD ["node", "src/server.js"]
