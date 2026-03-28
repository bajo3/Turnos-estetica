FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY backend ./
ENV HOST=0.0.0.0
EXPOSE 8080
CMD ["npm", "run", "start"]
