import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { advanceElapsed, copyCommand, dockerCommand, elapsedForStage, scenarios, stageAt, stages } from "./model.ts";
import type { Service } from "./model.ts";
import { resourceMetrics, resourceSamples } from "./resources.ts";
import generalImage from "../../../assets/general.png";
import storageImage from "../../../assets/storage.png";
import playerImage from "../../../assets/external-player.png";
import "./style.css";

const repository = "https://github.com/njzydark/MediaRelay";
const readme = `${repository}/tree/rust#readme`;

type StageIndex = 0 | 1 | 2;
type NodeKey = "client" | "relay" | "media" | "openlist" | "cloud";

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <span className={diagonal ? "arrow arrow-diag" : "arrow"} aria-hidden="true">
      {diagonal ? "↗" : "→"}
    </span>
  );
}

function Mark() {
  return (
    <span className="brand-badge" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
        <path
          d="M5 24V8l11 7.5L27 8v16M16 15.5V27"
          stroke="currentColor"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.59 2 12.253c0 4.53 2.865 8.374 6.839 9.73.5.095.682-.222.682-.493 0-.243-.009-.887-.014-1.741-2.782.619-3.369-1.374-3.369-1.374-.455-1.184-1.11-1.499-1.11-1.499-.908-.636.069-.623.069-.623 1.003.072 1.531 1.055 1.531 1.055.892 1.566 2.341 1.114 2.91.852.092-.663.35-1.114.636-1.37-2.22-.259-4.555-1.138-4.555-5.065 0-1.119.389-2.034 1.029-2.751-.103-.26-.446-1.302.098-2.714 0 0 .84-.276 2.75 1.05a9.35 9.35 0 0 1 2.504-.345c.85.004 1.705.118 2.504.345 1.909-1.326 2.748-1.05 2.748-1.05.545 1.412.202 2.454.1 2.714.64.717 1.028 1.632 1.028 2.751 0 3.937-2.339 4.803-4.566 5.057.359.317.678.943.678 1.9 0 1.371-.012 2.478-.012 2.814 0 .274.18.594.688.493C19.138 20.623 22 16.782 22 12.253 22 6.59 17.523 2 12 2Z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <path d="M2.8 1.7a.7.7 0 0 1 1.05-.6l6.7 4.3a.7.7 0 0 1 0 1.2l-6.7 4.3a.7.7 0 0 1-1.05-.6V1.7Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <rect x="2" y="1.5" width="3" height="9" rx="1" />
      <rect x="7" y="1.5" width="3" height="9" rx="1" />
    </svg>
  );
}

function CopyIcon({ copied }: { copied: boolean }) {
  if (copied) {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M3.2 8.4 6.4 11.6 12.8 4.8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M10.5 5.5V3.8A1.3 1.3 0 0 0 9.2 2.5H3.8A1.3 1.3 0 0 0 2.5 3.8v5.4a1.3 1.3 0 0 0 1.3 1.3h1.7"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function FeatureIcon({ kind }: { kind: "rules" | "logs" | "inject" }) {
  if (kind === "rules") {
    return (
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M3 5.5h14M6 10h8M8.5 14.5h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "logs") {
    return (
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M3 11.5h3l2-5 3 8 2-4.5h4"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M7 6.5 3.5 10 7 13.5M13 6.5 16.5 10 13 13.5M11.2 4.5l-2.4 11"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MetricIcon({ id }: { id: (typeof resourceMetrics)[number]["id"] }) {
  if (id === "image") {
    return (
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M10 2.8 16.5 6.4v7.2L10 17.2l-6.5-3.6V6.4L10 2.8Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M3.5 6.4 10 10l6.5-3.6M10 10v7.2" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  }
  if (id === "idle") {
    return (
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="6.8" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10 6.5V10l2.6 1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3 13.5 7 9.5l3 2.8 4.2-5.3L17 9.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M3 16.5h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function NodeGlyph({ kind }: { kind: NodeKey }) {
  switch (kind) {
    case "client":
      return (
        <path
          d="M9.5 6.8 15.8 10.5 9.5 14.2V6.8Z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      );
    case "relay":
      return (
        <path
          d="M5.5 15V6.5L10.5 10l5-3.5V15M10.5 10v6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "media":
      return (
        <>
          <rect x="4.5" y="5.5" width="12" height="10" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M4.5 8.8h12M8.2 5.5v3.3M12.8 5.5v3.3" stroke="currentColor" strokeWidth="1.4" />
        </>
      );
    case "openlist":
      return (
        <path
          d="M8.8 13.2 7.2 14.8a2.5 2.5 0 0 1-3.5-3.5l2.1-2.1a2.5 2.5 0 0 1 3.5 0M12.2 7.8l1.6-1.6a2.5 2.5 0 0 1 3.5 3.5l-2.1 2.1a2.5 2.5 0 0 1-3.5 0M8.2 12.8l4.6-4.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.55"
          strokeLinecap="round"
        />
      );
    case "cloud":
      return (
        <path
          d="M6.8 15h7.8a3.2 3.2 0 0 0 .4-6.38A4.4 4.4 0 0 0 6.5 7.9a2.9 2.9 0 0 0 .3 7.1Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.55"
          strokeLinejoin="round"
        />
      );
  }
}

function usePlaybackClock() {
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [foreground, setForeground] = useState(() => !document.hidden);
  const diagramRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    const visibility = () => setForeground(!document.hidden);
    document.addEventListener("visibilitychange", visibility);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false));
    if (diagramRef.current) observer.observe(diagramRef.current);
    return () => {
      media.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", visibility);
      observer.disconnect();
    };
  }, []);

  const running = !paused && visible && !reduced && foreground;
  useEffect(() => {
    if (!running) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      setElapsed((value) => advanceElapsed(value, now - previous));
      previous = now;
    }, 80);
    return () => window.clearInterval(timer);
  }, [running]);

  function selectStage(target: StageIndex) {
    setElapsed(elapsedForStage(target));
    setPaused(true);
  }

  return {
    diagramRef,
    paused,
    setPaused,
    selectStage,
    reduced,
    running,
    stage: (reduced ? 2 : stageAt(elapsed)) as StageIndex,
  };
}

function FlowDiagram() {
  const { diagramRef, paused, setPaused, selectStage, reduced, running, stage } = usePlaybackClock();
  return (
    <div
      ref={diagramRef}
      className={`playback-flow ${running ? "is-running" : "is-paused"} ${reduced ? "is-static" : ""}`}
      data-stage={stage}
    >
      <div className="flow-topline">
        <span className="flow-topline-title">
          <span className="flow-live-dot" aria-hidden="true" />
          播放链路演示
        </span>
        <span className="flow-kind">本地文件 / STRM 均支持</span>
      </div>
      <div className="diagram-stage">
        <DiagramDrawing mobile={false} />
        <DiagramDrawing mobile />
      </div>
      <div className="flow-caption">
        <div className="flow-caption-copy">
          <div className="flow-caption-head">
            <span className="step-count">0{stage + 1} / 03</span>
            <strong>{stages[stage].title}</strong>
          </div>
          <p>{stages[stage].detail}</p>
        </div>
        <button
          className="pause-button"
          type="button"
          disabled={reduced}
          onClick={() => setPaused(!paused)}
          aria-label={reduced ? "减少动态效果已开启，显示静态链路" : paused ? "播放链路动画" : "暂停链路动画"}
        >
          {reduced ? <span aria-hidden="true">—</span> : paused ? <PlayIcon /> : <PauseIcon />}
          <span>{reduced ? "静态" : paused ? "播放" : "暂停"}</span>
        </button>
      </div>
      <ol className="flow-steps" aria-label="播放流程">
        {stages.map((item, index) => {
          const stepIndex = index as StageIndex;
          const active = stage === stepIndex;
          return (
            <li key={item.title} aria-current={active ? "step" : undefined}>
              <button
                type="button"
                className={active ? "flow-step-button is-active" : "flow-step-button"}
                disabled={reduced}
                onClick={() => selectStage(stepIndex)}
                aria-pressed={active}
              >
                <span>0{index + 1}</span>
                {item.title}
              </button>
              {reduced && <p>{item.detail}</p>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function DiagramDrawing({ mobile }: { mobile: boolean }) {
  const id = mobile ? "mobile" : "desktop";
  const nodes: Record<NodeKey, [number, number]> = mobile
    ? { client: [28, 30], relay: [28, 198], media: [228, 198], openlist: [228, 372], cloud: [228, 540] }
    : { client: [30, 166], relay: [274, 166], media: [518, 28], openlist: [518, 166], cloud: [518, 326] };
  const paths = mobile
    ? {
        request: "M108 114V198",
        metadata: "M176 226H228",
        resolve: "M176 252H202V400H228",
        result: "M228 430H188V276H176",
        redirect: "M68 198V114",
        video: "M228 582H14V72H28",
      }
    : {
        request: "M178 194H274",
        metadata: "M348 166V70H518",
        resolve: "M422 194H518",
        result: "M518 224H422",
        redirect: "M274 224H178",
        video: "M518 368H104V250",
      };

  function node(key: NodeKey, title: string, caption: string, extra = "") {
    const [x, y] = nodes[key];
    return (
      <g transform={`translate(${x} ${y})`} className={`diagram-node node-${key} ${extra}`}>
        <rect className="node-card" width="148" height="84" rx="12" />
        <rect className="node-icon-bg" x="12" y="13" width="24" height="24" rx="6.5" />
        <g transform="translate(13.5 14.5)" className="node-icon">
          <NodeGlyph kind={key} />
        </g>
        <text className="node-title" x="43" y="30">
          {title}
        </text>
        <text className="node-caption" x="12" y="61">
          {caption}
        </text>
      </g>
    );
  }

  return (
    <svg
      className={`diagram diagram-${id}`}
      viewBox={mobile ? "0 0 404 656" : "0 0 698 446"}
      role="img"
      aria-labelledby={`${id}-title ${id}-desc`}
    >
      <title id={`${id}-title`}>本地文件与 STRM 共用的网盘直链播放流程</title>
      <desc id={`${id}-desc`}>
        客户端经 MediaRelay 请求 Emby 或 Jellyfin 的播放信息，MediaRelay 通过 Openlist 取得直链并返回 302。视频从网盘或
        CDN 直接流向客户端，不经过 MediaRelay。
      </desc>
      <defs>
        <pattern id={`${id}-grid`} width="22" height="22" patternUnits="userSpaceOnUse">
          <circle cx="11" cy="11" r="1" fill="#cbd5e1" opacity="0.65" />
        </pattern>
        <linearGradient id={`${id}-relay-grad`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2b64e8" />
          <stop offset="100%" stopColor="#1745b0" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#245bd6" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#245bd6" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-shadow`} x="-10%" y="-14%" width="120%" height="136%">
          <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#0f172a" floodOpacity="0.06" />
        </filter>
        <filter id={`${id}-relay-shadow`} x="-14%" y="-18%" width="128%" height="144%">
          <feDropShadow dx="0" dy="8" stdDeviation="10" floodColor="#1d4ed8" floodOpacity="0.26" />
        </filter>
        <marker
          id={`${id}-arrow`}
          markerUnits="userSpaceOnUse"
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3.5"
          orient="auto"
        >
          <path d="m1 1 5 2.5-5 2.5" fill="none" stroke="#8596b0" strokeWidth="1.3" strokeLinecap="round" />
        </marker>
        <marker
          id={`${id}-blue`}
          markerUnits="userSpaceOnUse"
          markerWidth="9"
          markerHeight="9"
          refX="8"
          refY="4.5"
          orient="auto"
        >
          <path d="m1 1 7 3.5-7 3.5" fill="none" stroke="#245bd6" strokeWidth="1.7" strokeLinecap="round" />
        </marker>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id}-grid)`} rx="14" />
      <circle
        cx={mobile ? 102 : 348}
        cy={mobile ? 240 : 208}
        r={mobile ? 150 : 185}
        fill={`url(#${id}-glow)`}
        pointerEvents="none"
      />
      <g className="control-paths" fill="none" strokeWidth="1.5" strokeDasharray="4 5" markerEnd={`url(#${id}-arrow)`}>
        <path className="path-request" d={paths.request} />
        <path className="path-request" d={paths.metadata} />
        <path className="path-resolve" d={paths.resolve} />
        <path className="path-resolve" d={paths.result} />
        <path className="path-resolve" d={paths.redirect} />
      </g>
      <path className="video-halo" d={paths.video} fill="none" strokeWidth="8" strokeLinecap="round" />
      <path className="video-track" d={paths.video} fill="none" strokeWidth="2.2" markerEnd={`url(#${id}-blue)`} />
      <path
        className="video-particles"
        d={paths.video}
        fill="none"
        strokeWidth="3.6"
        strokeDasharray="1 26"
        strokeLinecap="round"
      />
      <g className="diagram-labels">
        <g transform={mobile ? "translate(116 144)" : "translate(197 166)"}>
          <rect width="58" height="20" rx="10" className="label-pill" />
          <text x="29" y="13.5" textAnchor="middle">
            播放请求
          </text>
        </g>
        <g transform={mobile ? "translate(173 170)" : "translate(395 44)"}>
          <rect width="58" height="20" rx="10" className="label-pill" />
          <text x="29" y="13.5" textAnchor="middle">
            播放信息
          </text>
        </g>
        <g transform={mobile ? "translate(238 336)" : "translate(441 166)"}>
          <rect width="58" height="20" rx="10" className="label-pill" />
          <text x="29" y="13.5" textAnchor="middle">
            获取直链
          </text>
        </g>
        <g className="label-302-group" transform={mobile ? "translate(22 144)" : "translate(205 234)"}>
          <rect width="42" height="20" rx="10" className="label-302-pill" />
          <text className="label-302" x="21" y="13.8" textAnchor="middle">
            302
          </text>
        </g>
      </g>
      <g className="video-label" transform={mobile ? "translate(42 474)" : "translate(196 300)"}>
        <rect className="video-label-card" x="-12" y="-18" width={mobile ? 176 : 210} height="52" rx="10" />
        <text>视频流量 · 网盘直达客户端</text>
        <text y="20" className="video-label-sub">
          不经过 MediaRelay
        </text>
      </g>
      <g filter={`url(#${id}-shadow)`}>
        {node("client", "客户端", "你熟悉的播放方式")}
        {node("media", "Emby / Jellyfin", "本地文件 / STRM 条目")}
        {node("openlist", "Openlist", "根据文件路径获取直链")}
        {node("cloud", "网盘 / CDN", "视频文件所在的位置")}
      </g>
      <g filter={`url(#${id}-relay-shadow)`}>{node("relay", "MediaRelay", "请求中继 / 直链解析", "node-highlight")}</g>
    </svg>
  );
}

const screenshots = [
  {
    title: "路径映射",
    description: "把媒体库路径，接到 Openlist。",
    image: storageImage,
    alt: "MediaRelay 外部存储设置：Openlist 连接信息与路径映射配置",
  },
  {
    title: "外部播放器",
    description: "在熟悉的媒体页面，打开喜欢的播放器。",
    image: playerImage,
    alt: "MediaRelay 外部播放器的可视化 scheme 配置界面",
  },
  {
    title: "常规设置",
    description: "直链开关、缓存状态，一处掌握。",
    image: generalImage,
    alt: "MediaRelay 常规设置中的直链开关与缓存管理界面",
  },
];

const extraFeatures = [
  {
    index: "01",
    kind: "rules" as const,
    title: "规则过滤",
    description: "按 UA、IP、主机名与媒体路径，控制哪些请求走直链。",
  },
  {
    index: "02",
    kind: "logs" as const,
    title: "诊断日志",
    description: "查看解析、缓存、重定向与回退链路，定位播放问题。",
  },
  {
    index: "03",
    kind: "inject" as const,
    title: "自定义注入",
    description: "按需注入 JS / CSS，保留自己的媒体页面使用习惯。",
  },
];

function ProductTour() {
  const [selected, setSelected] = useState(0);
  const current = screenshots[selected] ?? screenshots[0];
  return (
    <section className="tour-section section-shell" id="features" aria-labelledby="features-title">
      <div className="section-heading">
        <div>
          <span className="section-number">核心能力 / 界面预览</span>
          <h2 id="features-title">
            播放方式不变。
            <br />
            背后的路径，更直接。
          </h2>
        </div>
        <p>
          不替换你的媒体服务。
          <br />
          在原有 Emby / Jellyfin 页面里，完成配置。
        </p>
      </div>
      <div className="tour-layout">
        <div className="tour-nav">
          {screenshots.map((item, index) => (
            <button
              className={index === selected ? "tour-choice selected" : "tour-choice"}
              key={item.title}
              type="button"
              onClick={() => setSelected(index)}
              aria-pressed={index === selected}
              aria-controls="tour-image"
            >
              <span className="tour-index">0{index + 1}</span>
              <span className="tour-choice-body">
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </span>
              <Arrow />
            </button>
          ))}
          <a className="text-link" href={readme}>
            查看完整功能说明 <Arrow diagonal />
          </a>
        </div>
        <figure className="screenshot-well" id="tour-image">
          <div className="window-bar">
            <div className="window-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p className="window-title">MediaRelay / {current.title}</p>
            <span className="window-tag">管理界面</span>
          </div>
          <div className="screenshot-frame">
            <img
              key={current.image}
              className="screenshot-image"
              src={current.image}
              alt={current.alt}
              width="1626"
              height="1364"
              loading="lazy"
            />
          </div>
          <figcaption>现有管理界面截图 · 非在线控制台</figcaption>
        </figure>
      </div>
      <div className="feature-ledger">
        {extraFeatures.map((feature) => (
          <div key={feature.title} className="feature-card">
            <div className="feature-card-head">
              <span className="feature-icon">
                <FeatureIcon kind={feature.kind} />
              </span>
              <span className="feature-index">{feature.index}</span>
            </div>
            <h3>{feature.title}</h3>
            <p>{feature.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ResourceUsage() {
  return (
    <section className="resources-section section-shell" id="resources" aria-labelledby="resources-title">
      <div className="section-heading">
        <div>
          <span className="section-number">资源占用 / 实测参考</span>
          <h2 id="resources-title">
            轻装运行。
            <br />
            占用看得见。
          </h2>
        </div>
        <p>
          运行时仅需 Rust 服务与静态资源。
          <br />
          无需 Node.js，以下为实际采样参考。
        </p>
      </div>
      <dl className="resource-metrics">
        {resourceMetrics.map((metric, index) => (
          <div key={metric.id} className="resource-card">
            <dt>
              <span className="resource-icon">
                <MetricIcon id={metric.id} />
              </span>
              <span className="resource-label">{metric.label}</span>
              <span className="resource-index">0{index + 1}</span>
            </dt>
            <dd className="resource-reading">
              <span className="resource-approx">约</span>
              <strong>{metric.value}</strong>
              <span className="resource-unit">MB</span>
            </dd>
            <dd className="resource-source">{metric.source}</dd>
            <dd className="resource-detail">{metric.detail}</dd>
          </div>
        ))}
      </dl>
      <div className="resource-notes">
        <p className="resource-disclaimer">
          {resourceSamples.date} 记录 · 仅为 MediaRelay 本身的样本，不含 Emby / Jellyfin 与 Openlist。
          实际占用随架构、缓存、日志与并发变化，不是固定值或内存上限。
        </p>
        <details className="resource-methods">
          <summary>采样条件与统计口径</summary>
          <div className="resource-methods-grid">
            <p>
              <strong>镜像：</strong>读取 {resourceSamples.image.reference} 的仓库清单，合计压缩层与配置大小。
              linux/amd64 约 13.9 MB，linux/arm64 约 13.5 MB；已有镜像层缓存时，实际下载量更少。
            </p>
            <p>
              <strong>空闲：</strong>全新配置、网络隔离、无客户端请求与上游连接。启动约 3 分钟后，三次 Docker stats
              读数均为 2.578 MiB，换算约 2.7 MB；这是容器内存统计，不是进程 RSS。
            </p>
            <p>
              <strong>使用中：</strong>用户提供的运行监控截图，{resourceSamples.normal.observedAt} 读数为 19.453 MB。
              未记录架构、并发与具体负载，不据此推断峰值或并发容量。
            </p>
            <p>
              本地测试与用户样本的环境、统计来源不同，不构成严格的空闲 / 负载对照测试。MB
              按十进制换算，用户截图沿用原始单位。
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}

function DockerCommandCode({ service }: { service: Service }) {
  const variable = service === "emby" ? "EMBY_URL" : "JELLYFIN_URL";
  return (
    <code>
      <span className="tok-cmd">docker run</span> <span className="tok-flag">-d</span>{" "}
      <span className="tok-flag">--name</span> mediarelay <span className="tok-slash">\</span>
      {"\n  "}
      <span className="tok-flag">-e</span> <span className="tok-var">{variable}</span>=
      <span className="tok-val">http://YOUR_MEDIA_SERVER:8096</span> <span className="tok-slash">\</span>
      {"\n  "}
      <span className="tok-flag">-v</span> <span className="tok-val">./config:/app/config</span>{" "}
      <span className="tok-slash">\</span>
      {"\n  "}
      <span className="tok-flag">-p</span> <span className="tok-val">3000:3000</span>{" "}
      <span className="tok-slash">\</span>
      {"\n  "}
      <span className="tok-img">ghcr.io/njzydark/mediarelay:rust</span>
    </code>
  );
}

function QuickStart() {
  const [service, setService] = useState<Service>("emby");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyAttempt = useRef(0);
  const command = dockerCommand(service);
  async function copy() {
    const attempt = ++copyAttempt.current;
    const result = await copyCommand(command, navigator.clipboard?.writeText.bind(navigator.clipboard));
    if (attempt === copyAttempt.current) setCopyState(result);
  }
  return (
    <section className="quickstart" id="quick-start" aria-labelledby="start-title">
      <div className="section-shell start-layout">
        <div className="start-intro">
          <span className="section-number">开始使用 / Docker</span>
          <h2 id="start-title">
            接上你的媒体库。
            <br />
            走一条直接的路。
          </h2>
          <p>准备好 Emby 或 Jellyfin，以及已挂载对应网盘的 Openlist。MediaRelay 负责把它们连接起来。</p>
          <a className="text-link" href={`${repository}/tree/rust#快速开始`}>
            完整部署说明 <Arrow diagonal />
          </a>
          <p className="release-note">
            示例使用 <code>rust</code> 镜像标签。维护者发布前，请按 README 本地构建镜像。
          </p>
        </div>
        <div className="start-content">
          <div className="command-panel">
            <div className="command-toolbar">
              <div className="command-toolbar-left">
                <div className="terminal-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="service-switch" role="group" aria-label="选择媒体服务">
                  {(["emby", "jellyfin"] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={service === item}
                      onClick={() => {
                        copyAttempt.current++;
                        setService(item);
                        setCopyState("idle");
                      }}
                    >
                      {item === "emby" ? "Emby" : "Jellyfin"}
                    </button>
                  ))}
                </div>
              </div>
              <button
                className={copyState === "copied" ? "copy-button is-copied" : "copy-button"}
                type="button"
                onClick={copy}
              >
                <CopyIcon copied={copyState === "copied"} />
                <span>{copyState === "copied" ? "已复制" : "复制命令"}</span>
              </button>
            </div>
            <pre tabIndex={0} aria-label={`${service === "emby" ? "Emby" : "Jellyfin"} Docker 启动命令`}>
              <DockerCommandCode service={service} />
            </pre>
            <p className="copy-feedback" role="status">
              {copyState === "failed"
                ? "复制失败，请选中上方命令手动复制。"
                : copyState === "copied"
                  ? "命令已复制，运行前请替换媒体服务器地址。"
                  : "将 YOUR_MEDIA_SERVER 替换为容器可访问的媒体服务器地址。"}
            </p>
          </div>
          <ol className="setup-steps">
            <li>
              <span className="setup-badge">01</span>
              <p>
                <strong>启动并访问</strong>打开 MediaRelay 所在主机的 3000 端口，登录你的媒体服务。
              </p>
            </li>
            <li>
              <span className="setup-badge">02</span>
              <p>
                <strong>连接 Openlist</strong>点击顶部头像进入 MediaRelay 设置，配置 Openlist 地址与凭据。
              </p>
            </li>
            <li>
              <span className="setup-badge">03</span>
              <p>
                <strong>对应媒体路径</strong>根据本地文件或 STRM 场景配置路径映射，再从客户端测试播放。
              </p>
            </li>
          </ol>
          <p className="config-note">
            <code>./config:/app/config</code> 持久化配置；已有配置请保留，不要覆盖。
          </p>
        </div>
      </div>
    </section>
  );
}

const faqs = [
  [
    "为什么能改善公网观看体验？",
    "当媒体服务器的上行带宽成为播放瓶颈时，走网盘直链可以让视频从网盘 / CDN 直接到达客户端，减少视频中转对服务器上行的依赖。实际效果仍取决于网盘限速、客户端到网盘的网络、视频码率与直链配置，不保证所有环境下都不卡顿。",
  ],
  [
    "本地没有视频文件，也可以使用吗？",
    "可以，典型场景是 STRM 媒体库：本地保留条目或指向信息，视频实体在网盘。但媒体服务必须能提供有效条目，并能通过解析、路径映射关联到 Openlist 中的对应文件。MediaRelay 不会凭空找回任意缺失文件。",
  ],
  [
    "视频流量会经过 MediaRelay 吗？",
    "直链成功时，MediaRelay 处理播放信息与直链解析，再用 302 引导客户端访问网盘 / CDN；视频流量不经过 MediaRelay。未走直链的请求仍使用原有上游代理链路。",
  ],
  [
    "直链失败后会发生什么？",
    "解析失败会回退到上游媒体服务代理。能否继续播放取决于上游媒体是否实际可用；本地没有视频实体文件时，回退不代表一定可以播放。最终客户端访问网盘的结果也受网络和网盘限制影响。",
  ],
  [
    "可以多人共享使用吗？",
    "本项目仅限个人使用。多人使用会增加网盘风控风险，直链能否成功也受到客户端网络、网盘规则及配置等因素影响。",
  ],
  [
    "遇到问题，在哪里反馈？",
    "先检查管理界面的诊断日志，确认问题发生在媒体查询、路径映射、Openlist 解析还是客户端访问阶段。按仓库说明，GitHub Issues 暂时关闭，请通过下方 Telegram 社区沟通；分享日志前注意脱敏。",
  ],
];

function App() {
  return (
    <>
      <a className="skip-link" href="#main">
        跳转到主要内容
      </a>
      <header className="site-header">
        <div className="header section-shell">
          <a className="brand" href="#top" aria-label="MediaRelay 首页">
            <Mark />
            <span>MediaRelay</span>
          </a>
          <nav aria-label="主导航">
            <a href="#scenarios">使用场景</a>
            <a href="#features">功能</a>
            <a href="#resources">资源占用</a>
            <a href="#quick-start">快速开始</a>
          </nav>
          <a className="header-github" href={repository}>
            <GitHubIcon />
            <span>GitHub</span>
            <Arrow diagonal />
          </a>
        </div>
      </header>
      <main id="main">
        <div className="hero-band">
          <section className="hero section-shell" id="top" aria-labelledby="hero-title">
            <div className="hero-copy">
              <div className="hero-signature">
                <span className="signal-dot" aria-hidden="true" />
                为 Emby / Jellyfin 的公网播放而造
              </div>
              <h1 id="hero-title">
                让公网观影
                <br />
                <span className="hero-accent">更流畅。</span>
              </h1>
              <p className="hero-lead">
                减少媒体服务器上行带宽对播放的限制。通过 Openlist
                获取网盘直链，让视频直接到达客户端，保留熟悉的媒体库与播放器。
              </p>
              <p className="hero-condition">
                支持本地文件与 STRM 媒体库。接入方式不同，最终都通过 Openlist 获取网盘直链。
              </p>
              <div className="hero-actions">
                <a className="btn btn-primary" href="#quick-start">
                  快速开始 <Arrow />
                </a>
                <a className="btn btn-secondary" href={repository}>
                  <GitHubIcon />
                  查看源码 <Arrow diagonal />
                </a>
              </div>
              <div className="hero-footnote">
                <span>Rust 后端</span>
                <span>开源 · MIT</span>
                <span>为个人媒体库而造</span>
              </div>
            </div>
            <div className="hero-demo">
              <FlowDiagram />
              <p className="flow-fallback">直链解析失败时回退上游代理；能否继续播放取决于上游媒体是否可用。</p>
            </div>
          </section>
        </div>
        <div className="compatibility-band">
          <div className="compatibility-strip section-shell">
            <span className="strip-label">和你的媒体库一起工作</span>
            <div className="stack-pills">
              <strong className="stack-pill">Emby</strong>
              <span className="stack-sep" aria-hidden="true">
                /
              </span>
              <strong className="stack-pill">Jellyfin</strong>
              <span className="stack-sep" aria-hidden="true">
                +
              </span>
              <strong className="stack-pill stack-pill-accent">Openlist</strong>
            </div>
            <span className="strip-end">请求中继，而非另一套媒体服务。</span>
          </div>
        </div>
        <section className="scenarios-section section-shell" id="scenarios" aria-labelledby="scenarios-title">
          <div className="section-heading">
            <div>
              <span className="section-number">接入方式 / 两种场景</span>
              <h2 id="scenarios-title">
                两种媒体库。
                <br />
                同一条直达路线。
              </h2>
            </div>
            <p>
              区别在于如何关联文件，
              <br />
              而不是播放时走哪条链路。
            </p>
          </div>
          <div className="scenario-stories">
            {(["local", "strm"] as const).map((item, index) => (
              <article key={item} className="scenario-card">
                <div className="story-heading">
                  <span className="story-number">0{index + 1}</span>
                  <span>{index === 0 ? "已有视频，也有网盘副本" : "只留条目，不落地完整视频"}</span>
                </div>
                <h3>{scenarios[item].title}</h3>
                <p>{scenarios[item].description}</p>
                <div className="path-example">
                  <span className="path-chip">{item === "local" ? "/media/电影.mkv" : "电影.strm / 媒体条目"}</span>
                  <Arrow />
                  <span className="path-chip">Openlist</span>
                  <Arrow />
                  <strong className="path-chip path-chip-target">网盘直链</strong>
                </div>
              </article>
            ))}
          </div>
          <p className="scenario-caveat">
            共同前提：媒体服务中存在有效条目，Openlist 可访问对应文件，客户端能够访问最终直链。
          </p>
        </section>
        <ProductTour />
        <ResourceUsage />
        <QuickStart />
        <section className="faq-section section-shell" id="faq" aria-labelledby="faq-title">
          <div className="faq-intro">
            <span className="section-number">使用之前</span>
            <h2 id="faq-title">
              几个你可能
              <br />
              想确认的问题。
            </h2>
            <a className="text-link" href={readme}>
              阅读 README <Arrow diagonal />
            </a>
          </div>
          <div className="faq-list">
            {faqs.map(([question, answer]) => (
              <details key={question}>
                <summary>
                  <span>{question}</span>
                  <span className="faq-toggle" aria-hidden="true">
                    +
                  </span>
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <footer className="footer-band">
        <div className="footer section-shell">
          <div className="footer-main">
            <a className="brand" href="#top">
              <Mark />
              <span>MediaRelay</span>
            </a>
            <p>为公网观看，连接更直接的播放路径。</p>
            <a className="btn btn-secondary btn-compact" href="#quick-start">
              开始部署 <Arrow />
            </a>
          </div>
          <div className="footer-bottom">
            <p>开源软件 · MIT License · 仅限个人使用</p>
            <nav aria-label="页脚导航">
              <a href={repository}>
                GitHub <Arrow diagonal />
              </a>
              <a href={readme}>
                文档 <Arrow diagonal />
              </a>
              <a href="https://t.me/+fFFWvWa0yxxiYTdl">
                Telegram <Arrow diagonal />
              </a>
            </nav>
            <a href={`${repository}/blob/rust/LICENSE`}>MIT License</a>
          </div>
        </div>
      </footer>
    </>
  );
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
