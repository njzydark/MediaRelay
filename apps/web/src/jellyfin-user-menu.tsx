import type { Root } from "react-dom/client";
import { SettingsDialog } from "./components/settings-dialog/index.tsx";
import { useTranslation } from "./i18n/index.ts";

// Jellyfin's React user menu replaces the legacy mypreferencesmenu/viewshow entry point.
export function observeJellyfinUserMenu(root: Root) {
  let trigger: HTMLButtonElement | null = null;
  let mounted = false;

  function SettingsTrigger() {
    const { t } = useTranslation();
    return (
      <SettingsDialog>
        <button
          ref={(element) => {
            trigger = element;
          }}
          type="button"
          hidden
        >
          {t("app.title")}
        </button>
      </SettingsDialog>
    );
  }

  const inject = () => {
    const menu = document.querySelector("#app-user-menu");
    const dashboard = menu?.querySelector('a[role="menuitem"][href="#/dashboard"]');
    const settings = menu?.querySelector('a[role="menuitem"][href="#/mypreferencesmenu"]');
    if (!menu || !dashboard || !settings || menu.querySelector('[data-id="mediarelay-settings"]')) return;

    // Keep the dialog in our own root: Jellyfin can hide or recreate its menu independently.
    if (!mounted) {
      mounted = true;
      root.render(<SettingsTrigger />);
    }

    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = settings.className;
    entry.dataset.id = "mediarelay-settings";
    entry.setAttribute("role", "menuitem");
    entry.tabIndex = -1;
    entry.style.width = "100%";
    entry.style.textAlign = "start";
    for (const child of settings.childNodes) entry.appendChild(child.cloneNode(true));
    const label = entry.querySelector(".MuiListItemText-primary");
    if (!label) return;
    label.textContent = "MediaRelay";
    entry.addEventListener("click", () => {
      // Release MUI's focus trap before opening the MediaRelay dialog.
      menu.querySelector<HTMLElement>(".MuiBackdrop-root")?.click();
      setTimeout(() => trigger?.click(), 0);
    });
    dashboard.before(entry);
  };

  const observer = new MutationObserver(inject);
  observer.observe(document.body, { childList: true, subtree: true });
  inject();
  return () => observer.disconnect();
}
