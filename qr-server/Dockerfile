FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY index.js ./

ENV NODE_ENV=production

RUN mkdir -p /app/auth-info

EXPOSE 8788

CMD ["node", "index.js"]