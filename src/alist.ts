import config from "../config.json" with { type: "json" };
import { env } from "./env.ts";

type ApiResponse<T> = {
  code: number;
  message?: string;
  data?: T;
};

const { embyToAlistPathMap } = config;

const transformAlistFilePath = (_path: string) => {
  let path = decodeURIComponent(_path);
  Object.entries(embyToAlistPathMap || {}).forEach(([embyPath, alistPath]) => {
    path = path.replace(embyPath, alistPath);
  });
  return path;
};

export const getAlistFileRawUrl = async (
  path: string,
  extra: {
    ua: string;
    ip?: string;
  },
) => {
  try {
    const headers: Record<string, string> = {
      Authorization: env.alistToken || "",
      "Content-Type": "application/json",
      "User-Agent": extra.ua,
      Referer: "",
    };

    if (extra.ip) {
      headers["X-Forwarded-For"] = extra.ip;
      headers["X-Real-IP"] = extra.ip;
    }

    const response = await fetch(`${env.alistUrl}/api/fs/get`, {
      method: "POST",
      headers,
      body: JSON.stringify({ path: transformAlistFilePath(path) }),
    });

    const data: ApiResponse<{ raw_url?: string }> = await response.json();
    console.log("[alist api response]", data);
    return data.data?.raw_url;
  } catch (err) {
    console.error("getAlistFileRawUrl error", err);
  }
};
