// deno-lint-ignore-file ban-types
export type MediaStreams = {
  Codec: "h264" | "eac3" | "subrip" | "ass" | (string & {});
  Type: "Video" | "Audio" | "Subtitle" | (string & {});
  Protocol: "File" | "Http";
  IsDefault: boolean;
  IsExternal: boolean;
  DisplayTitle: string;
  SupportsExternalStream: boolean;
  Path: string;
  Index: number;
}[];

export type MediaSources = {
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
  MediaStreams: MediaStreams;
  DefaultSubtitleStreamIndex?: number;
}[];

export type ItemsApiResponse = {
  Items: {
    Id: string;
    Path: string;
    MediaSources?: MediaSources;
  }[];
};

export type UserItem = {
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
  MediaSources?: MediaSources;
  MediaStreams?: MediaStreams;
  UserData?: {
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

export type UserItemsApiResponse = {
  TotalRecordCount: number;
  Items: UserItem[];
};
