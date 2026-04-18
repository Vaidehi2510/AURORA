# Build from repo root: docker compose build aurora-web
# Same-origin API: leave VITE_AURORA_API unset so the browser calls /api/... (nginx → aurora-api).
FROM node:20-alpine AS build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_AURORA_API=
ENV VITE_AURORA_API=$VITE_AURORA_API
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY docker/nginx/aurora.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
