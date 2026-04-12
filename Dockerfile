FROM node:22-slim AS base
WORKDIR /opt/claw
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

FROM base AS build
COPY package.json pnpm-lock.yaml* package-lock.json* ./
RUN corepack enable && \
    if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; \
    else npm ci; fi
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM base AS runtime
COPY --from=build /opt/claw/dist ./dist
COPY --from=build /opt/claw/node_modules ./node_modules
COPY package.json ./
COPY templates/ ./templates/
COPY config/ ./config/

RUN addgroup --system claw && adduser --system --ingroup claw claw
USER claw

EXPOSE 18789 3000

CMD ["node", "dist/index.js"]
