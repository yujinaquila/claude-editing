FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates fonts-dejavu \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

ENV NODE_ENV=production
ENV PORT=8080
ENV MAX_CONCURRENT_JOBS=1
EXPOSE 8080

CMD ["node", "server.js"]
