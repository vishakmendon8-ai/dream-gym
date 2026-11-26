FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY schema.sql ./
COPY src ./src
COPY public ./public

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV SQLITE_PATH=/tmp/adms.db

EXPOSE 8080

CMD ["node", "src/server.js"]
