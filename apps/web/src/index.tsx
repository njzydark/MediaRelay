import "./styles/theme.module.less";
import styles from "./index.module.less";

import { createRoot, type Root } from "react-dom/client";
import { createPortal } from "react-dom";
import { SettingsEntryButton } from "@/components/settings-entry-button/index.tsx";
import { SettingsDialog } from "@/components/settings-dialog/index.tsx";
import { Button } from "@/ui/button/index.tsx";
import { isEmby, isJellyfin } from "./utils.ts";

const init = async (cb: (root: Root) => void) => {
  if (!document.body) {
    await new Promise((resolve) => {
      const timer = globalThis.setInterval(() => {
        if (document.body) {
          globalThis.clearInterval(timer);
          resolve(true);
        }
      }, 280);
    });
  }

  const container = document.createElement("div");
  container.id = "mediarelay-webui";
  container.className = styles.wrapper;
  document.body.appendChild(container);

  const root = createRoot(container);
  cb(root);
};

init((root) => {
  // @ts-expect-error no env type
  if (import.meta.env.DEV) {
    root.render(
      <>
        {createPortal(
          <SettingsDialog>
            <Button>MediaRelay Settings</Button>
          </SettingsDialog>,
          document.body,
        )}
      </>,
    );
  } else if (isEmby) {
    let obs: MutationObserver | null = null;
    document.addEventListener("click", (e) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.className?.includes?.("headerUserButton") ||
        target?.parentElement?.className?.includes?.("headerUserButton")
      ) {
        if (obs) {
          obs.disconnect();
        }
        obs = new MutationObserver(() => {
          const dialogEl = document.querySelector(".dialogBackdropOpened");
          if (!dialogEl) {
            return;
          }

          setTimeout(() => {
            const targetBtn = dialogEl.querySelector<HTMLButtonElement>(
              'button[data-id="manageserver"]',
            );
            if (!targetBtn) return;

            const injectedBtn = dialogEl.querySelector<HTMLButtonElement>(
              'button[data-id="mediarelay-settings"]',
            );
            if (injectedBtn) return;

            const container = document.createElement("div");
            targetBtn.insertAdjacentElement("beforebegin", container);

            root.render(
              <>
                {createPortal(
                  <SettingsDialog>
                    <SettingsEntryButton className={`${targetBtn.className}`} style={{ width: "100%" }} />
                  </SettingsDialog>,
                  container,
                )}
              </>,
            );
          }, 0);
        });

        obs.observe(document.body, { childList: true, subtree: false });
      }
    });
  } else if (isJellyfin) {
    const entryBtnId = "media-relay-entry-btn";
    globalThis.addEventListener("viewshow", function (e) {
      if (globalThis.location.hash.includes("/mypreferencesmenu")) {
        const detailPageElement = e.target as HTMLElement;
        const container = detailPageElement?.querySelector(".adminSection") as HTMLElement;
        if (container) {
          const entryBtn = detailPageElement?.querySelector(`.${entryBtnId}`);
          if (entryBtn) {
            return;
          }
          root.render(
            <>
              {createPortal(
                <SettingsDialog>
                  <SettingsEntryButton className={entryBtnId} style={{ width: "100%" }} />
                </SettingsDialog>,
                container,
              )}
            </>,
          );
        }
      }
    });
  }
});
