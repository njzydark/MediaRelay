import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const dist = new URL("../dist/", import.meta.url);
const html = await readFile(new URL("index.html", dist), "utf8");
assert.match(html, /lang="zh-CN"/);
assert.match(html, /MediaRelay/);
assert.match(html, /让公网观影更流畅/);
assert.doesNotMatch(html, /\/mediarelay\/(api|webui)/);

// Resolve the built references under both mount points; no SPA fallback can hide a bad URL.
async function verifyReferences(text, source, pattern) {
  for (const match of text.matchAll(pattern)) {
    const reference = match[1];
    if (!reference || /^(?:https?:|data:|#)/.test(reference)) continue;
    assert.ok(!reference.startsWith("/"), `Root-relative asset in ${source}: ${reference}`);
    for (const prefix of ["/", "/MediaRelay/"]) {
      const publicURL = new URL(reference, `https://example.test${prefix}${source}`);
      assert.ok(publicURL.pathname.startsWith(prefix), `Asset escaped base ${prefix}`);
      const relative = decodeURIComponent(publicURL.pathname.slice(prefix.length));
      assert.ok((await stat(new URL(relative, dist))).isFile(), `Missing asset: ${relative}`);
    }
  }
}

await verifyReferences(html, "index.html", /(?:src|href)="([^"]+)"/g);
async function inspect(directory, relative = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = `${relative}${entry.name}`;
    if (entry.isDirectory()) await inspect(new URL(`${entry.name}/`, directory), `${name}/`);
    else if (name.endsWith(".css")) {
      const css = await readFile(new URL(entry.name, directory), "utf8");
      await verifyReferences(css, name, /url\(["']?([^\s)"']+)["']?\)/g);
    }
  }
}
await inspect(dist);
console.log(`Static references verified at / and /MediaRelay/: ${fileURLToPath(dist)}`);
