# Developer Guidelines for Emby2Openlist

This document outlines the development standards, commands, and conventions for the Emby2Openlist codebase. This project is a Deno-based monorepo.

## 1. Toolchain & Commands

This project uses **Deno** for runtime, testing, linting, and formatting.

### Core Commands
- **Dev Server**: `deno task dev` (Starts the server in `apps/server`)
- **Compile**: `deno task compile` (Compiles the server to a binary)
- **Format Code**: `deno task fmt` (Runs `deno fmt`)
- **Lint Code**: `deno task lint` (Runs `deno lint`)
- **Run Tests**: `deno task test` (Runs all tests in parallel)

### Running Specific Tests
To run a specific test file or test case, use the standard Deno test flags:
```bash
# Run a specific test file
deno test -A packages/shared/utils.test.ts

# Run a specific test case by name (regex)
deno test -A --filter "my test case" packages/shared/utils.test.ts
```

## 2. Project Structure

The project follows a monorepo structure:
- **`apps/server`**: The main application entry point (Hono server).
- **`packages/`**: Shared libraries and specific integrations.
  - **`shared`**: Common utilities, types, and interfaces (`@lib/shared`).
  - **`emby`**: Emby integration logic and client (`@lib/emby`).
  - **`openlist`**: Openlist/Alist integration (`@lib/openlist`).

## 3. Code Style & Conventions

### Formatting
- **Indentation**: 2 spaces.
- **Line Width**: 120 characters.
- **Quotes**: Double quotes (`"`).
- **Semicolons**: Always use semicolons (`true`).
- **Enforcement**: Run `deno task fmt` to automatically fix formatting.

### Naming Conventions
- **Files**: Kebab-case (e.g., `external-player.ts`, `video-cors.ts`).
- **Classes**: PascalCase (e.g., `EmbyClient`, `MediaServer`).
- **Functions/Variables**: camelCase (e.g., `bootstrap`, `calculateMaxAgeMs`).
- **Interfaces/Types**: PascalCase (e.g., `EmbyConfig`, `ItemsApiResponse`).

### TypeScript
- **Strictness**: Types should be explicit. Avoid `any` unless absolutely necessary (though `no-explicit-any` is currently excluded in lint rules, prefer strict types).
- **Interfaces**: Define interfaces for API responses and configuration objects.
- **Imports**:
  - Use mapped imports defined in `deno.json` for internal packages (e.g., `import { ... } from "@lib/shared";`).
  - Use `jsr:` or `npm:` prefixes for external dependencies as defined in `deno.json` imports.

### Error Handling
- Use `try...catch` blocks for external API calls and async operations.
- Log errors using `console.error` with descriptive messages.
- Fail gracefully or return `null`/default values where appropriate to prevent server crashes.

### Logging
- Use `console.log` for general info and `console.error` for errors.
- The Hono logger middleware is also enabled in the main server application.

## 4. Architecture & Patterns

- **Dependency Injection**: Configuration is typically passed into class constructors (e.g., `new EmbyClient(config)`).
- **Interfaces**: The `MediaServer` interface in `@lib/shared` defines the contract for media server integrations.
- **Hono**: The server uses Hono for routing and middleware.
- **Environment**: Configuration is loaded from environment variables/config files via `loadConfig()` in `apps/server/config.ts`.
