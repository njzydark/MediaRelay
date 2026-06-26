/// <reference lib="dom" />
const mediaElementConstructors = [HTMLVideoElement, HTMLAudioElement];

for (const mediaElementConstructor of mediaElementConstructors) {
  Object.defineProperty(mediaElementConstructor.prototype, "crossOrigin", {
    set: function () {
      console.log("[Bypass] Blocked media element from setting crossorigin");
    },
    get: function () {
      return null;
    },
  });
}

const originalSetAttribute = Element.prototype.setAttribute;
Element.prototype.setAttribute = function (this: Element, ...args: string[]) {
  const name = args[0];
  if (
    typeof name === "string" && name.toLowerCase() === "crossorigin" &&
    (this.tagName === "VIDEO" || this.tagName === "AUDIO")
  ) {
    console.log(`[Bypass] Blocked setAttribute crossorigin on ${this.tagName}`);
    return;
  }
  return originalSetAttribute.apply(this, args as [string, string]);
};

const meta = document.createElement("meta");
meta.name = "referrer";
meta.content = "no-referrer";
document.head.appendChild(meta);

console.log("[Success] Emby Media CORS Protection Disabled");
