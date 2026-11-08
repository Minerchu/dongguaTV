FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache ca-certificates tzdata

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN chmod +x /app/entrypoint.sh \
    && mkdir -p /app/data

ENV DB_PATH=/app/data/db.json

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
