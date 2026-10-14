FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY .env.example ./.env.example

ENV NODE_ENV=production
ENV PORT=7000
ENV DATA_DIR=/app/data

RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 7000

CMD ["node", "src/server.js"]
