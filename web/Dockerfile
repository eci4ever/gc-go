FROM node:24.18.0-alpine AS builder

WORKDIR /src

COPY package.json package-lock.json ./
COPY web/package.json web/package.json
RUN npm ci

COPY web ./web
RUN npm run build

FROM caddy:2-alpine

COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /src/web/dist /srv
