import QuickLRU from "quick-lru";

export const directUrlCache = new QuickLRU<string, string>({ maxSize: 500, maxAge: 3600 * 1000 });

export const embyItemPathCache = new QuickLRU<string, string>({ maxSize: 500, maxAge: 3600 * 1000 });

export const generateDirectUrlCacheKey = ({ id, ua }: { id: string | number; ua: string }) => {
  return `${id}:${ua}`;
};
