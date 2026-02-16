# AGENTS.md

## Project Context & Principles

**Goal**:

To improve Emby/Jellyfin playback performance by redirecting media requests to high-speed direct links (via Openlist/115 Drive), bypassing the low-bandwidth Emby server

**Core Workflow (The "Why"):**

1.  **Intercept**: The HonoJS server acts as a middleware/proxy for the Emby Client/Emby Web
2.  **Rewrite**: When a specific API request (e.g., `/Items/{Id}/PlaybackInfo`) is detected:
    - Extract the media hash/id
    - Resolve the direct download link using `/packages/openlist`
    - Replace the original media source URL in the JSON response
3.  **Proxy**: All other non-media requests (images, metadata) are transparently proxied to the upstream Emby server

**Key Concepts**:

- **Upstream**: The original Emby Server
- **Direct Link**: The short-lived, high-speed URL from the cloud storage
- **Rewriter**: The logic that patches the JSON response body

## Tech Stack & Frameworks

### Core
- **Runtime**: Deno 2.x (Use `deno` for all commands)
- **Package Management**: Deno Workspaces (No `package.json`, use `deno.json` imports)
- **Build Tool (App)**: Rsbuild (Rspack based)
- **Build Tool (Lib)**: Rslib (Rspack based)

### Backend (API)
- **Framework**: HonoJS (Deno adapter)
- **Logic**: Pure TypeScript

### Frontend (Web UI)
- **Framework**: react 19
- **UI**: [BaseUI](https://base-ui.com/llms.txt)

## Project Structure

- `/apps/web`: react 19 Frontend application (built with Rsbuild)
- `/apps/server`: HonoJS Backend server
- `/packages/shared`: shared types/logic
- `/packages/openlist`: openlist logic for get direct url
- `/packages/emby`: emby login for rewrite emby response (built with Rslib)
- `/deno.json`: Root configuration

## Critical Development Rules (MUST FOLLOW)

### Deno & TypeScript

- Use Web Standard APIs (Request, Response, fetch)

### Verification Standards (The "Definition of Done")

Before finalizing any code change, ensure it passes strict Deno standards:

- **Format**: Code must match `deno fmt` rules
- **Lint**: No `deno lint` errors
- **Types**: Must pass `deno check`. **DO NOT** use `@ts-ignore` unless absolutely necessary and documented

## Code style

```json
"useTabs": false,
"lineWidth": 120,
"indentWidth": 2,
"semiColons": true,
"singleQuote": false,
"proseWrap": "preserve",
```

## Common commands

```bash
# test
deno test
# lint
deno lint
# types check
deno check
# format code
deno fmt
# server dev watch mode
deno task dev
# compile server
deno task compile
```

## Unit Test Guidelines

Follow BDD (Behavior Driven Development) style using Deno Standard Library. Do not use Jest or Vitest syntax

```ts
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import { calculateMaxAgeMs, getCommonDataFromRequest, isWebBrowser, playbackPositionTicksToSeconds } from "./utils.ts";

describe("playbackPositionTicksToSeconds", () => {
  it("basic", () => {
    expect(playbackPositionTicksToSeconds(10_000_000)).toBe("1");
    expect(playbackPositionTicksToSeconds(0)).toBe("0");
    expect(playbackPositionTicksToSeconds(1_359_000)).toBe("0.135");
    expect(playbackPositionTicksToSeconds(1_354_000)).toBe("0.135");
  });

  it("custom fraction digits", () => {
    // 0.0019 seconds = 19,000 ticks
    const ticks = 19000;
    expect(playbackPositionTicksToSeconds(ticks)).toBe("0.001");
    expect(playbackPositionTicksToSeconds(ticks, { fractionDigits: 2 })).toBe("0");
    expect(playbackPositionTicksToSeconds(ticks, { fractionDigits: 4 })).toBe("0.0019");
  });
});
```