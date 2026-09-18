# Stage 1: Build TypeScript
FROM node:22-alpine AS builder

WORKDIR /app

# bcrypt may need to compile from source on musl-based Alpine.
RUN apk add --no-cache python3 make g++

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build && npm prune --omit=dev

# Stage 2: Production Runner
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

USER node

EXPOSE 4000

CMD ["node", "dist/server.js"]
