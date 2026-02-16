export const isJellyfin = globalThis.ApiClient?._appName?.toLowerCase()?.includes("jellyfin") ||
  globalThis._mediarelay_type === "jellyfin";
export const isEmby = globalThis.ApiClient?._appName?.toLowerCase()?.includes("emby") ||
  globalThis._mediarelay_type === "emby";
