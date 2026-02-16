import type { CSSProperties } from "react";
import { useTranslation } from "@/i18n/index.ts";
import { isEmby, isJellyfin } from "../../utils.ts";

type Props = {
  style?: CSSProperties;
  className?: string;
  onClick?: () => void;
};

export const SettingsEntryButton = ({ className, style, onClick }: Props) => {
  const { t } = useTranslation();

  if (isEmby) {
    return (
      <button
        className={className}
        data-id="mediarelay-settings"
        data-action="custom"
        type="button"
        style={style}
        onClick={onClick}
      >
        <div className="listItem-content listItem-content-margin listItem-content-bg listItemCursor-touchzoom listItem-border actionsheet-noborder">
          <div
            data-action="custom"
            className="actionSheetItemImageContainer actionSheetItemImageContainer-transparent listItemImageContainer listItemImageContainer-smallest listItemImageContainer-square listItemImageContainer-round defaultCardBackground"
            style={{ aspectRatio: 1 }}
          >
            <i className="actionsheetMenuItemIcon listItemIcon listItemIcon-transparent md-icon listItemIcon md-icon autortl">
              settings
            </i>
          </div>
          <div className="actionsheetListItemBody actionsheetListItemBody-iconright listItemBody listItemBody-reduceypadding listItemBody-2-lines">
            <div className="listItemBodyText actionSheetItemText listItemBodyText-lf">
              {t("app.title")}
            </div>
          </div>
        </div>
      </button>
    );
  }

  if (isJellyfin) {
    return (
      <a
        className={`${className} emby-button listItem-border`}
        onClick={onClick}
        style={{ display: "block", margin: 0, padding: 0 }}
      >
        <div className="listItem">
          <span className="material-icons listItemIcon listItemIcon-transparent settings" aria-hidden="true"></span>
          <div className="listItemBody">
            <div className="listItemBodyText">{t("app.title")}</div>
          </div>
        </div>
      </a>
    );
  }

  return null;
};
