FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache tzdata

ENV TZ=Asia/Manila

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build

EXPOSE 5053

CMD ["node", "server.js"]