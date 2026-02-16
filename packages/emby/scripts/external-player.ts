/// <reference lib="dom" />
/// <reference path="./types.d.ts" />

import type { UserItem } from "../types.ts";

import {
  getExternalPlayers,
  getPlatform,
  playbackPositionTicksToSeconds,
  transformExternalPlayerScheme,
} from "@lib/shared";

const PLAYER_ICONS: Record<string, string> = {
  vlc: "https://images.videolan.org/images/favicon.ico",
  potplayer: "https://t1.daumcdn.net/potplayer/main/img/favicon.ico",
  iina: "https://iina.io/images/iina-icon-60.png",
  default: '<i class="md-icon md-icon-fill button-icon button-icon-left autortl"></i>',
};

const isUrlIcon = (icon: string) => icon?.startsWith("http") || icon?.startsWith("/") || icon?.startsWith("data:image");

async function getPlayableItem(itemId: string) {
  const apiClient = globalThis.ApiClient;
  if (!apiClient) return null;

  const userId = apiClient.getCurrentUserId();
  const item = await apiClient.getItem(userId, itemId);

  if (item.Type === "Series") {
    const nextUp = await apiClient.getNextUpEpisodes({ SeriesId: itemId, UserId: userId, Limit: 1 });
    if (nextUp.Items && nextUp.Items.length > 0) return nextUp.Items[0];
    const episodes = await apiClient.getItems(userId, {
      ParentId: itemId,
      Limit: 1,
      Recursive: true,
      IncludeItemTypes: "Episode",
    });
    return episodes.Items?.[0];
  }
  if (item.Type === "Season") {
    const episodes = await apiClient.getEpisodes(item.SeriesId!, { SeasonId: itemId, UserId: userId });
    return episodes.Items?.[0];
  }
  return item;
}

async function injectButtons(container: HTMLElement, playableItem: UserItem) {
  if (!container || !playableItem) {
    return;
  }

  const existingGroup = container.querySelector(".btnExternalPlayerGroup");
  if (existingGroup) {
    container.removeChild(existingGroup);
  }

  const group = document.createElement("div");
  group.className =
    "btnExternalPlayerGroup verticalFieldItem detailButtons mainDetailButtons flex align-items-flex-start flex-wrap-wrap focuscontainer-x detail-lineItem detailButtons-margin focusable";

  const platform = getPlatform();
  const players = getExternalPlayers(globalThis.EXTERNAL_PLAYER_CONFIG, platform);

  const { ParentIndexNumber = -1, IndexNumber = -1, Id, SeriesName, SeasonName, Name, UserData } = playableItem;

  players.forEach((player) => {
    const btn = document.createElement("button");
    btn.className = "raised detailButton emby-button button-hoverable";
    btn.type = "button";
    btn.title = player.name;

    const iconKey = (player.icon || player.name).toLowerCase();
    const playerIcon = isUrlIcon(player.icon || "") ? player.icon : (PLAYER_ICONS[iconKey] || PLAYER_ICONS.default);

    const iconHtml = isUrlIcon(playerIcon || "")
      ? `<img src="${playerIcon}" style="width:100%;height:100%;object-fit:contain;" />`
      : playerIcon;

    btn.innerHTML = `
<div style="display:flex;align-items:center;gap:0.4em;">
  <div style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;">
    ${iconHtml}
  </div>
  ${iconHtml && player.iconOnly ? "" : `<span class="buttonText">${player.name}</span>`}
</div>
`;

    btn.onclick = () => {
      const mediaSourceSelectEl: HTMLSelectElement | null = container.querySelector("select.selectSource");
      const mediaSourceSelectValue = mediaSourceSelectEl?.value;
      const mediaSourceId = mediaSourceSelectValue || `mediasource_${Id}`;
      const currentMediaSource = playableItem.MediaSources?.find((item) => item.Id === mediaSourceId);

      const subtitlesSelectEl: HTMLSelectElement | null = container.querySelector("select.selectSubtitles");
      const subtitlesSelecctValue = subtitlesSelectEl?.value;
      const allSubtitles = currentMediaSource?.MediaStreams?.reduce(
        (acc, item) => {
          if (item.IsExternal === true && item.SupportsExternalStream === true && item.Type === "Subtitle") {
            const url =
              `${globalThis.location.origin}/emby/Videos/${Id}/${mediaSourceId}/Subtitles/${item.Index}/Stream.${item.Codec}?X-Emby-Token=${globalThis.ApiClient._userAuthInfo.AccessToken}`;
            acc.push({
              url,
              title: item.DisplayTitle || "",
              Index: item.Index,
              isDefault: item.Index?.toString() === subtitlesSelecctValue || item.IsDefault ||
                item.Index === currentMediaSource.DefaultSubtitleStreamIndex,
            });
          }
          return acc;
        },
        [] as ({
          url: string;
          title: string;
          Index: number;
          isDefault: boolean;
        })[],
      )?.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));

      let titleIndex = "";
      if (ParentIndexNumber >= 0 && IndexNumber >= 0) {
        titleIndex = `S${ParentIndexNumber}:E${IndexNumber}`;
      }
      const title = [SeriesName, SeasonName, Name, titleIndex].filter(Boolean).join(" ") ||
        "Video";
      const videoUrl =
        `${globalThis.location.origin}/Videos/${Id}/stream?MediaSourceId=${mediaSourceId}&Static=true&FakeDirectStream=true&X-Emby-Token=${globalThis.ApiClient._userAuthInfo.AccessToken}`;
      const playbackPositionTicks = UserData?.PlaybackPositionTicks || 0;
      const startSeconds = playbackPositionTicksToSeconds(playbackPositionTicks);
      console.log({ title, videoUrl, allSubtitles, startSeconds, mediaSourceSelectValue, subtitlesSelecctValue });

      const finalUrl = transformExternalPlayerScheme(player.scheme, {
        videoUrl,
        title,
        allSubtitles,
        startSeconds,
      });
      console.log("[ExternalPlayer] Opening:", finalUrl);
      globalThis.location.href = finalUrl;
    };

    group.appendChild(btn);
  });
  const mainDetailButtons = container.querySelector(".mainDetailButtons");
  if (mainDetailButtons) {
    mainDetailButtons.after(group);
  }
}

globalThis.addEventListener("viewshow", async function (e) {
  console.log("[njzy debug]", e);
  if (e.detail.path === "/item") {
    const itemId = e.detail.params.id;
    const playableItem = await getPlayableItem(itemId);
    console.log("[njzy debug]", playableItem);
    if (!playableItem) return;

    const viewEl = e.detail.view;
    const container = viewEl.querySelector(".detailTextContainer") as HTMLElement;
    if (container) {
      injectButtons(container, playableItem);
    }
  }
});
