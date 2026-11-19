FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ARG NEXT_PUBLIC_USER_API_BASE_URL=/api/v1
ENV NEXT_PUBLIC_USER_API_BASE_URL=${NEXT_PUBLIC_USER_API_BASE_URL}
ARG NEXT_PUBLIC_USER_AGREEMENT_VERSION=2026-11-20
ENV NEXT_PUBLIC_USER_AGREEMENT_VERSION=${NEXT_PUBLIC_USER_AGREEMENT_VERSION}
ARG NEXT_PUBLIC_PRIVACY_POLICY_VERSION=2026-11-20
ENV NEXT_PUBLIC_PRIVACY_POLICY_VERSION=${NEXT_PUBLIC_PRIVACY_POLICY_VERSION}
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
