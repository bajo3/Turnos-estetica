FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm install
COPY frontend ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY frontend/package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY frontend/vite.config.js ./vite.config.js
ENV HOST=0.0.0.0
EXPOSE 4173
CMD ["sh", "-c", "npm run start"]
