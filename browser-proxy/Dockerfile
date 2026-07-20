FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY src ./src
COPY bin ./bin
ENV NODE_ENV=production \
    CLAUDIO_BROWSER_PROXY_HOST=0.0.0.0 \
    CLAUDIO_BROWSER_PROXY_PORT=8080 \
    BRIDGE_MODE=openai \
    BROWSER_PROXY_DATA_DIR=/data \
    CLAUDIO_BROWSER_PROXY_MODE=local
EXPOSE 8080
VOLUME ["/data"]
CMD ["node", "src/index.js"]
