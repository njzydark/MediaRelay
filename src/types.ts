// deno-lint-ignore-file ban-types
export type EmbyMediaStreams = {
  Codec: "h264" | "eac3" | "subrip" | (string & {});
  Type: "Video" | "Audio" | "Subtitle" | (string & {});
  Protocol: "File" | "Http";
  IsDefault: boolean;
}[];

export type EmbyMediaSources = {
  // mediasource_36868
  Id: string;
  // 36868
  ItemId: string;
  Path: string;
  Name: string;
  Container?: "strm";
  SupportsTranscoding: boolean;
  SupportsDirectStream: boolean;
  SupportsDirectPlay: boolean;
  DirectStreamUrl: string;
  TranscodingUrl: string;
  Url?: string;
  TranscodeReasons?: unknown[];
  Protocol?: "File" | "Http";
  enableDirectPlay?: boolean;
  MediaStreams: EmbyMediaStreams;
}[];

export type EmbyItemsApiResponse = {
  Items: {
    Id: string;
    Path: string;
    MediaSources?: EmbyMediaSources;
  }[];
};

export type EmbyUserItemApiResponse = {
  Name: string;
  Id: string;
  CanDelete: boolean;
  CanDownload: boolean;
  SupportsSync: boolean;
  SortName: string;
  ForcedSortName: string;
  ExternalUrls: { Name: string; Url: string }[];
  Path: string;
  RunTimeTicks: number;
  FileName: string;
  ProviderIds: Record<string, string>;
  IsFolder: boolean;
  Type: "Series" | "Season" | "Episode";
  UserData: {
    PlaybackPositionTicks: number;
    IsFavorite: boolean;
    Played: boolean;
  };
  ChildCount?: number;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  ParentId?: string;
  SeriesName?: string;
  SeriesId?: string;
  SeasonId?: string;
  SeasonName?: string;
};

export type EmbyNextUpEpisodesApiResponse = {
  TotalRecordCount: number;
  Items: (Omit<EmbyUserItemApiResponse, "Type"> & {
    Type: "Episode";
  })[];
};

export type ExternalPlayerConfig = {
  enabled: boolean;
  common?: {
    name: string;
    scheme: string;
    icon?: string;
  }[];
  platforms: {
    [key: string]: {
      name: string;
      scheme: string;
      icon?: string;
    }[];
  };
};
