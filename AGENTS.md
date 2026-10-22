# MediaRelay Development

## Purpose

MediaRelay proxies Emby/Jellyfin requests and redirects media playback to Openlist direct links. Preserve existing client behavior and the `/mediarelay` UI/API namespace.

## Stack

- Backend: Rust 2024, Tokio, Axum, Hyper for streaming HTTP proxying, Reqwest for bounded API calls.
- Frontend: Node.js 24 LTS, pnpm workspace, TypeScript, React 19, BaseUI, Rsbuild and Rslib.
- Frontend lint/format: Oxc (`oxlint` / `oxfmt`), not ESLint or Prettier.
- Rust is the only server runtime. Node.js is needed only for frontend development/builds. Do not reintroduce Deno.
- Use the tool versions in `rust-toolchain.toml`, `.node-version` and `package.json`; commit both lockfiles.

## Layout

- `apps/server`: Rust backend, integration tests and generated static resources.
- `apps/web`: React administration UI.
- `packages/emby`, `packages/jellyfin`: browser injection scripts and browser API types.
- `packages/shared`: browser-side types and utilities.

## Compatibility Rules

- Rewrite upstream JSON using the complete `serde_json::Value`, with `arbitrary_precision` enabled. Only change the explicitly intended fields; never reconstruct responses from partial DTOs.
- Preserve unknown fields recursively, numeric precision, missing values and nulls. Remove fields where the original JS used `undefined`; do not insert null instead.
- Stream ordinary request/response bodies. Never buffer media downloads. Preserve encoded paths, duplicate query parameters, status codes, Range responses and repeated response headers.
- Failed rewrites return the original response; failed direct-link resolution falls back to the upstream proxy.
- Keep configuration/API field names, units and frontend asset URLs compatible. Retain unknown configuration fields.

## Rust Practices

- Keep state bounded. Reuse HTTP clients, do not hold locks across network awaits, and make cancellation/configuration races explicit.
- Use typed errors and graceful shutdown. No `unwrap`/`expect` in production request paths, and no unsafe code without a documented necessity.
- Never log credentials, authentication query strings, signed direct links or response body previews.
- Use Rust's standard formatter. Use Node's `node:test` describe/it and native assertions for TS tests; test core behavior with mocks, not live credentials.

## Verification

```sh
cargo fmt --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo build --release --locked
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm fmt:check
pnpm test
pnpm build
```

Run `pnpm build && cargo run -p mediarelay` from the repository root. Preserve local configuration and never commit credentials. Do not publish images or push branches unless requested.
