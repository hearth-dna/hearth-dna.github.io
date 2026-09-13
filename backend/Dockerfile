# Mirrors ../sentio/backend/Dockerfile minus Litestream: this service has no database.
FROM golang:1.25-alpine AS builder
RUN apk add --no-cache git ca-certificates
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags='-w -s' -o server ./cmd/server

FROM alpine:latest
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 1000 appuser
WORKDIR /app
COPY --from=builder /app/server .
USER appuser
EXPOSE 8080
ENTRYPOINT ["./server"]
