FROM node:22-bookworm-slim

# Chrome Headless Shell runtime libs (Remotion), ffmpeg/ffprobe for asset probing, emoji font.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates fonts-noto-color-emoji \
      libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 libxrandr2 libxkbcommon-dev libxfixes3 \
      libxcomposite1 libxdamage1 libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npx remotion browser ensure
COPY . .

ENV PORT=3900 DATA_DIR=/data NODE_ENV=production
EXPOSE 3900
VOLUME ["/data"]
CMD ["node", "server.js"]
