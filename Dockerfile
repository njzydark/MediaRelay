FROM node:24.18.1-bookworm-slim AS web
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/emby/package.json ./packages/emby/package.json
COPY packages/jellyfin/package.json ./packages/jellyfin/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY apps/web ./apps/web
COPY packages ./packages
COPY scripts ./scripts
RUN pnpm build

FROM rust:1.93.1-bookworm AS server
WORKDIR /app
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY apps/server ./apps/server
RUN cargo build --release --locked -p mediarelay

FROM gcr.io/distroless/cc-debian12
WORKDIR /app
ENV CONFIG_DIR=/app/config STATIC_DIR=/app/static
COPY --from=server /app/target/release/mediarelay ./mediarelay
COPY --from=web /app/apps/server/static ./static
EXPOSE 3000
ENTRYPOINT ["./mediarelay"]
