FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
RUN npm ci --omit=dev --workspace server
COPY server/src ./server/src
EXPOSE 4000
CMD ["sh", "-c", "node server/src/migrate.js && node server/src/index.js"]
