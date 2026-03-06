FROM node:20-alpine

RUN apk add --no-cache openssh-client

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data

EXPOSE 3847

CMD ["node", "monitor.js"]
