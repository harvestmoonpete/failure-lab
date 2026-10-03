FROM node:22.14.0-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_MODE=live
ARG VITE_BASE=/
ENV VITE_MODE=$VITE_MODE VITE_BASE=$VITE_BASE
RUN npm run build
FROM build AS api
CMD ["npm","run","server"]
FROM nginx:1.27.4-alpine AS web
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
