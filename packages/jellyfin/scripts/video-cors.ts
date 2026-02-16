/// <reference lib="dom" />
Object.defineProperty(HTMLVideoElement.prototype, "crossOrigin", {
  set: function () {
    console.log("[Bypass] Blocked Emby from setting crossorigin");
  },
  get: function () {
    return null;
  },
});

const originalSetAttribute = Element.prototype.setAttribute;
Element.prototype.setAttribute = function (this: Element, ...args: string[]) {
  const name = args[0];
  if (typeof name === "string" && name.toLowerCase() === "crossorigin" && this.tagName === "VIDEO") {
    console.log("[Bypass] Blocked setAttribute crossorigin on VIDEO");
    return;
  }
  return originalSetAttribute.apply(this, args as [string, string]);
};

const meta = document.createElement("meta");
meta.name = "referrer";
meta.content = "no-referrer";
document.head.appendChild(meta);

console.log("[Success] Video CORS Protection Disabled");
