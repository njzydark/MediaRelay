import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
for (const [source, target] of [
  ["apps/web/dist/", "webui"],
  ["packages/emby/dist/", "emby"],
  ["packages/jellyfin/dist/", "jellyfin"],
]) {
  const destination = new URL(`apps/server/static/${target}/`, root);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(new URL(source, root), destination, { recursive: true });
  console.log(`Static assets ready: ${fileURLToPath(destination)}`);
}
