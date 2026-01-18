# Build stage
FROM denoland/deno:alpine-2.6.4 AS builder
WORKDIR /app
COPY . .
# Install dependencies (use just `deno install` if deno.json has imports)
RUN deno task compile

# Production stage
FROM alpine:latest
WORKDIR /app
COPY --from=builder /app/emby2openlist .
CMD ["./emby2openlist"]