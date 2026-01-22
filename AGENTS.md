# Agent Guidelines for emby2openlist

This document provides essential information for agentic coding tools operating in this repository.

## Project Overview

`emby2openlist` is a Deno-based proxy service that redirects Emby media library playback links to Alist direct links
(specifically for 115 Cloud). It aims to solve bandwidth issues when accessing Emby libraries over the public internet.

- **Runtime**: [Deno](https://deno.com/) (>= 2.6.x)
- **Framework**: [Hono](https://hono.dev/)
- **Entry Point**: `src/index.ts`

## Command Reference

### Development & Build

- **Start Development**: `deno task start`
  - Runs with `--watch`, `--allow-net`, `--allow-read`, `--allow-env`, and loads `.env` automatically.
- **Lint Code**: `deno task lint`
  - Note: `no-explicit-any` and `no-unused-vars` are currently excluded from linting rules.
- **Format Code**: `deno fmt`
- **Compile to Binary**: `deno task compile`
  - Outputs an `emby2openlist` executable.

### Testing

- **Run All Tests**: `deno task test`
  - Requires `--allow-net`.
- **Run Single Test File**: `deno test --allow-net src/path/to/file.test.ts`
- **Run with Watch Mode**: `deno test --watch src/path/to/file.test.ts`

## Code Style & Guidelines

### 1. Imports

- **Extensions**: Always include the `.ts` extension for relative imports (e.g., `import { foo } from "./utils.ts";`).
- **Standard Library**: Prefer using JSR or JSR-aliased imports in `deno.json`.
- **JSON**: Use the `with { type: "json" }` attribute for JSON imports.
  ```typescript
  import config from "../config.json" with { type: "json" };
  ```

### 2. Formatting

- **Indentation**: 2 spaces.
- **Line Width**: 120 characters.
- **Semicolons**: Always use semicolons.
- **Quotes**: Double quotes for strings.
- **Trailing Commas**: Use trailing commas in multi-line objects and arrays.

### 3. Naming Conventions

- **Variables & Functions**: `camelCase` (e.g., `handleRewritePlaybackInfo`, `itemId`).
- **Types & Interfaces**: `PascalCase` (e.g., `ApiResponse`, `ProxyConfig`).
- **Environment Variables**: `SNAKE_CASE` (e.g., `EMBY_URL`, `ALIST_TOKEN`).
- **Files**: `kebab-case.ts` (e.g., `cache.test.ts`, `handler.ts`).

### 4. Types

- **Strict Typing**: Leverage TypeScript to define clear interfaces for API responses and internal data structures.
- **Avoid `any`**: While the linter allows it, try to avoid `any` and define proper types/interfaces.
- **JSR Packages**: Prefer `@std` packages for standard utilities (expect, testing, dotenv).

### 5. Error Handling

- **Try-Catch**: Use `try...catch` blocks for network requests and external API interactions.
- **Logging**: Use `console.error` for errors and `console.log`/`console.time` for performance monitoring/debugging.
- **Graceful Degradation**: If an Alist direct link cannot be fetched, fall back to the original Emby stream or proxy
  the request.

### 6. Framework Specifics (Hono)

- Use `Context` (typed as `c: Context`) for handling requests/responses in route handlers.
- Use `logger()` middleware for important routes.
- Implement handlers as exported constants in `src/handler.ts`.

## Project Structure

- `src/index.ts`: Application entry point and route definitions.
- `src/handler.ts`: Route handler implementations.
- `src/emby.ts`: Logic specific to Emby metadata and playback info rewriting.
- `src/alist.ts`: Integration with Alist API.
- `src/proxy.ts`: Generic proxy request generation logic.
- `src/utils.ts`: Shared utility functions.
- `src/types.ts`: Global type definitions.
- `src/cache.ts`: Caching mechanism for direct links.

## Testing Guidelines

- **BDD Style**: Use `@std/testing/bdd` for `describe`, `it`, `beforeEach`.
- **Assertions**: Use `@std/expect`.
- **Mocks**: Use `FakeTime` from `@std/testing/time` for testing time-sensitive logic like caches.
- **Naming**: Test files should be named `<module>.test.ts` and reside in the same directory as the module they test.

## Environment Variables

Ensure the following variables are defined in `.env` or the environment:

- `EMBY_URL`: Address of the Emby server.
- `ALIST_URL`: Address of the Alist server.
- `ALIST_TOKEN`: Alist API token.
- `PORT`: (Optional) Port to run the service on (default: 3000).

---

_Note: This file is intended for agentic consumption. Adhere to these rules when proposing or making changes._
