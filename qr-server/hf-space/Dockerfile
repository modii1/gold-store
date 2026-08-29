# Dockerfile خاص بـ Hugging Face Spaces — يستمع على البورت 7860 الذي توفره المنصة
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY index.js ./

ENV NODE_ENV=production
ENV HTTP_PORT=7860

RUN mkdir -p /app/auth-info

EXPOSE 7860

CMD ["node", "index.js"]