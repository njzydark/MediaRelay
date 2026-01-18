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
}[];

export type EmbyItemsApiResponse = {
  Items: {
    Id: string;
    Path: string;
    MediaSources?: EmbyMediaSources;
  }[];
};
