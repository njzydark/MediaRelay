// deno-lint-ignore-file ban-types
import type { ExternalPlayerConfig } from "@lib/shared";
import type { UserItem, UserItemsApiResponse } from "../types.ts";

declare global {
  interface EmbyItem {
    Id: string;
    Name: string;
    Type: "Series" | "Season" | "Episode" | "Movie" | (string & {});
    SeriesName?: string;
    SeriesId?: string;
    [key: string]: any;
  }

  interface EmbyItemResult {
    Items: EmbyItem[];
    TotalRecordCount: number;
  }

  interface ApiClientInstance {
    getCurrentUserId(): string;
    getItem(userId: string, itemId: string): Promise<UserItem>;
    getItems(userId: string, options: Record<string, any>): Promise<UserItemsApiResponse>;
    getNextUpEpisodes(options: { SeriesId: string; UserId: string; Limit?: number }): Promise<UserItemsApiResponse>;
    getEpisodes(seriesId: string, options: { SeasonId?: string; UserId?: string }): Promise<UserItemsApiResponse>;
    getApiKeys(): Promise<{
      Items: { Id: number; Type: "ApiKey" | (string & {}); AccessToken: string; IsActive: boolean; AppName: string }[];
    }>;
    [key: string]: any;
  }

  interface Window {
    ApiClient: ApiClientInstance;
    EXTERNAL_PLAYER_CONFIG: ExternalPlayerConfig;
  }

  var ApiClient: ApiClientInstance;
  var EXTERNAL_PLAYER_CONFIG: ExternalPlayerConfig;

  interface ViewShowDetail {
    path: string;
    params: {
      id: string;
      [key: string]: string;
    };
    view: HTMLElement;
    type: string;
  }

  interface ViewShowEvent extends Event {
    detail: ViewShowDetail;
  }

  interface WindowEventMap {
    "viewshow": ViewShowEvent;
  }
}

export {};
