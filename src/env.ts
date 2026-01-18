import { load } from "@std/dotenv";

await load({ export: true });

export const env = {
  embyUrl: Deno.env.get("EMBY_URL")!,
  embyApiKey: Deno.env.get("EMBY_API_KEY")!,
  alistUrl: Deno.env.get("ALIST_URL")!,
  alistToken: Deno.env.get("ALIST_TOKEN")!,
  port: Number(Deno.env.get("PORT") || 3000),
};

export const checkEnv = () => {
  if (!env.embyUrl || !env.embyApiKey || !env.alistUrl || !env.alistToken) {
    console.error("please check env config");
    Deno.exit(1);
  }
};
