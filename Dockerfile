# Build stage
FROM denoland/deno:2.8.3 AS builder
WORKDIR /app
COPY . .
RUN deno task compile

# Production stage
FROM gcr.io/distroless/cc-debian12
WORKDIR /app
ENV CONFIG_DIR=/app/config
COPY --from=builder /app/apps/server/mediarelay .
COPY --from=builder /app/apps/server/static ./static
CMD ["./mediarelay"]