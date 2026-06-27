/// <reference lib="dom" />
const mediaElementConstructors = [HTMLVideoElement, HTMLAudioElement];

const isCrossOriginUrl = (value: string) => {
  if (!value) {
    return false;
  }

  try {
    return new URL(value, globalThis.location.href).origin !== globalThis.location.origin;
  } catch {
    return false;
  }
};

const isRedirectedMediaUrl = (value: string) => {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value, globalThis.location.href);
    return url.searchParams.has("FakeDirectStream") ||
      /\/(?:Videos|Audio)\/[^/]+\/(?:stream(?:\.[^/]*)?|universal)\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
};

const isCrossOriginAudioElement = (value: unknown): value is HTMLAudioElement => {
  if (!(value instanceof HTMLAudioElement)) {
    return false;
  }

  const src = value.currentSrc || value.src;
  if (!src) {
    return true;
  }

  return isCrossOriginUrl(src) || isRedirectedMediaUrl(src);
};

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

const patchAudioContext = (AudioContextConstructor: typeof AudioContext | undefined) => {
  if (!AudioContextConstructor?.prototype.createMediaElementSource) {
    return;
  }

  const originalCreateMediaElementSource = AudioContextConstructor.prototype.createMediaElementSource;
  AudioContextConstructor.prototype.createMediaElementSource = function (
    this: AudioContext,
    mediaElement: HTMLMediaElement,
  ) {
    if (isCrossOriginAudioElement(mediaElement)) {
      console.log("[Bypass] Blocked WebAudio media source for cross-origin AUDIO");
      return this.createGain() as unknown as MediaElementAudioSourceNode;
    }

    return originalCreateMediaElementSource.call(this, mediaElement);
  };
};

patchAudioContext(globalThis.AudioContext);
patchAudioContext((globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);

const meta = document.createElement("meta");
meta.name = "referrer";
meta.content = "no-referrer";
document.head.appendChild(meta);

console.log("[Success] Media CORS Protection Disabled");
