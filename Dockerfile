# SnapFree en EasyPanel: Node 22 + Python (yt-dlp) + ffmpeg
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg curl \
 && pip3 install --no-cache-dir --break-system-packages yt-dlp \
 && apt-get clean && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev --no-audit --no-fund
COPY backend/ ./backend/
COPY frontend/ ./frontend/
ENV PORT=3000 DATA_DIR=/app/data
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "backend/server.js"]
