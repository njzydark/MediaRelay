import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { advanceElapsed, copyCommand, dockerCommand, scenarios, stageAt, stages } from "./model.ts";
import type { Scenario, Service } from "./model.ts";
import generalImage from "../../../assets/general.png";
import storageImage from "../../../assets/storage.png";
import playerImage from "../../../assets/external-player.png";
import "./style.css";

const repository = "https://github.com/njzydark/MediaRelay";
const readme = `${repository}/tree/rust#readme`;

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <span aria-hidden="true">{diagonal ? "↗" : "→"}</span>;
}

function Mark() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M4 24V7l12 8L28 7v17M16 15v12" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}

function usePlaybackClock(scenario: Scenario) {
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

  useEffect(() => setElapsed(0), [scenario]);
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
  }, [running, scenario]);

  return { diagramRef, paused, setPaused, reduced, running, stage: reduced ? 2 : stageAt(elapsed) };
}

function FlowDiagram({ scenario }: { scenario: Scenario }) {
  const { diagramRef, paused, setPaused, reduced, running, stage } = usePlaybackClock(scenario);
  return (
    <div
      ref={diagramRef}
      className={`flow-panel ${running ? "is-running" : "is-paused"} ${reduced ? "is-static" : ""}`}
      data-stage={stage}
    >
      <div className="flow-topline">
        <span>
          <i className="status-dot" />
          播放链路演示
        </span>
        <span className="flow-kind">{scenarios[scenario].short}</span>
      </div>
      <DiagramDrawing scenario={scenario} mobile={false} />
      <DiagramDrawing scenario={scenario} mobile />
      <div className="flow-caption">
        <div>
          <span className="step-count">0{stage + 1} / 03</span>
          <strong>{stages[stage].title}</strong>
          <p>{stages[stage].detail}</p>
        </div>
        <button
          className="pause-button"
          type="button"
          disabled={reduced}
          onClick={() => setPaused(!paused)}
          aria-label={reduced ? "减少动态效果已开启，显示静态链路" : paused ? "播放链路动画" : "暂停链路动画"}
        >
          <span aria-hidden="true">{reduced ? "—" : paused ? "▶" : "Ⅱ"}</span>
          {reduced ? "静态" : paused ? "播放" : "暂停"}
        </button>
      </div>
      <ol className="flow-steps" aria-label="播放流程">
        {stages.map((item, index) => (
          <li key={item.title} aria-current={stage === index ? "step" : undefined}>
            <span>0{index + 1}</span>
            {item.title}
            {reduced && <p>{item.detail}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function DiagramDrawing({ scenario, mobile }: { scenario: Scenario; mobile: boolean }) {
  const id = mobile ? "mobile" : "desktop";
  const nodes = mobile
    ? { client: [24, 28], relay: [24, 176], media: [224, 176], openlist: [224, 324], cloud: [224, 472] }
    : { client: [24, 142], relay: [245, 142], media: [476, 20], openlist: [476, 142], cloud: [476, 270] };
  const paths = mobile
    ? {
        request: "M95 110V176",
        metadata: "M166 205H224",
        resolve: "M166 230H195V351H224",
        result: "M224 380H180V257H166",
        redirect: "M55 176V110",
        video: "M224 513H12V69H24",
      }
    : {
        request: "M166 170H245",
        metadata: "M320 142V61H476",
        resolve: "M387 170H476",
        result: "M476 200H387",
        redirect: "M245 200H166",
        video: "M476 311H95V224",
      };
  function node(key: keyof typeof nodes, title: string, caption: string, icon: string, extra = "") {
    const [x, y] = nodes[key];
    return (
      <g transform={`translate(${x} ${y})`} className={`diagram-node node-${key} ${extra}`}>
        <rect width="142" height="82" rx="9" />
        <text className="node-symbol" x="15" y="27">
          {icon}
        </text>
        <text className="node-title" x="15" y="49">
          {title}
        </text>
        <text className="node-caption" x="15" y="67">
          {caption}
        </text>
      </g>
    );
  }
  return (
    <svg
      className={`diagram diagram-${id}`}
      viewBox={mobile ? "0 0 390 580" : "0 0 650 378"}
      role="img"
      aria-labelledby={`${id}-title ${id}-desc`}
    >
      <title id={`${id}-title`}>{scenarios[scenario].title}：网盘直链播放流程</title>
      <desc id={`${id}-desc`}>
        客户端经 MediaRelay 请求 Emby 或 Jellyfin 的播放信息，MediaRelay 通过 Openlist 取得直链并返回 302。视频从网盘或
        CDN 直接流向客户端，不经过 MediaRelay。
      </desc>
      <defs>
        <pattern id={`${id}-grid`} width="22" height="22" patternUnits="userSpaceOnUse">
          <path d="M10 11h2" stroke="#c8d3e1" strokeWidth="1" />
        </pattern>
        <marker id={`${id}-arrow`} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="m1 1 5 3-5 3" fill="none" stroke="#7b8ca6" strokeWidth="1.2" />
        </marker>
        <marker id={`${id}-blue`} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="m1 1 5 3-5 3" fill="none" stroke="#245bd6" strokeWidth="1.4" />
        </marker>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id}-grid)`} />
      <g className="control-paths" fill="none" strokeWidth="1.4" strokeDasharray="4 5" markerEnd={`url(#${id}-arrow)`}>
        <path className="path-request" d={paths.request} />
        <path className="path-request" d={paths.metadata} />
        <path className="path-resolve" d={paths.resolve} />
        <path className="path-resolve" d={paths.result} />
        <path className="path-resolve" d={paths.redirect} />
      </g>
      <path className="video-track" d={paths.video} fill="none" strokeWidth="3" markerEnd={`url(#${id}-blue)`} />
      <path
        className="video-particles"
        d={paths.video}
        fill="none"
        strokeWidth="5"
        strokeDasharray="1 28"
        strokeLinecap="round"
      />
      <g className="diagram-labels">
        <text x={mobile ? 104 : 185} y={mobile ? 148 : 157}>
          播放请求
        </text>
        <text x={mobile ? 174 : 333} y={mobile ? 192 : 79}>
          播放信息
        </text>
        <text x={mobile ? 235 : 402} y={mobile ? 309 : 157}>
          获取直链
        </text>
        <text className="label-302" x={mobile ? 12 : 181} y={mobile ? 148 : 221}>
          302
        </text>
      </g>
      <g className="video-label" transform={mobile ? "translate(111 432)" : "translate(176 265)"}>
        <text>视频流量 · 网盘直达客户端</text>
        <text y="20" className="video-label-sub">
          不经过 MediaRelay
        </text>
      </g>
      {node("client", "客户端", "你熟悉的播放方式", "▷")}
      {node("relay", "MediaRelay", "请求中继 / 直链解析", "↗", "node-highlight")}
      {node("media", "Emby / Jellyfin", scenarios[scenario].source, "▤")}
      {node("openlist", "Openlist", "映射路径 → 获取直链", "⌁")}
      {node("cloud", "网盘 / CDN", "视频文件所在的位置", "☁")}
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

function ProductTour() {
  const [selected, setSelected] = useState(0);
  const current = screenshots[selected] ?? screenshots[0];
  return (
    <section className="tour-section section-shell" id="features" aria-labelledby="features-title">
      <div className="section-heading">
        <h2 id="features-title">
          播放方式不变。
          <br />
          背后的路径，更直接。
        </h2>
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
              <span>
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
            <span />
            <span />
            <span />
            <p>MediaRelay / {current.title}</p>
          </div>
          <img key={current.image} src={current.image} alt={current.alt} width="1626" height="1364" loading="lazy" />
          <figcaption>现有管理界面截图 · 非在线控制台</figcaption>
        </figure>
      </div>
      <div className="feature-ledger">
        <div>
          <span>01</span>
          <h3>规则过滤</h3>
          <p>按 UA、IP、主机名与媒体路径，控制哪些请求走直链。</p>
        </div>
        <div>
          <span>02</span>
          <h3>诊断日志</h3>
          <p>查看解析、缓存、重定向与回退链路，定位播放问题。</p>
        </div>
        <div>
          <span>03</span>
          <h3>自定义注入</h3>
          <p>按需注入 JS / CSS，保留自己的媒体页面使用习惯。</p>
        </div>
      </div>
    </section>
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
              <button className="copy-button" type="button" onClick={copy}>
                {copyState === "copied" ? "已复制 ✓" : "复制命令"}
              </button>
            </div>
            <pre tabIndex={0} aria-label={`${service === "emby" ? "Emby" : "Jellyfin"} Docker 启动命令`}>
              <code>{command}</code>
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
              <span>01</span>
              <p>
                <strong>启动并访问</strong>打开 MediaRelay 所在主机的 3000 端口，登录你的媒体服务。
              </p>
            </li>
            <li>
              <span>02</span>
              <p>
                <strong>连接 Openlist</strong>点击顶部头像进入 MediaRelay 设置，配置 Openlist 地址与凭据。
              </p>
            </li>
            <li>
              <span>03</span>
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
  const [scenario, setScenario] = useState<Scenario>("local");
  return (
    <>
      <a className="skip-link" href="#main">
        跳转到主要内容
      </a>
      <header className="header section-shell">
        <a className="brand" href="#top" aria-label="MediaRelay 首页">
          <Mark />
          <span>MediaRelay</span>
        </a>
        <nav aria-label="主导航">
          <a href="#scenarios">使用场景</a>
          <a href="#features">功能</a>
          <a href="#quick-start">快速开始</a>
        </nav>
        <a className="header-github" href={repository}>
          GitHub <Arrow diagonal />
        </a>
      </header>
      <main id="main">
        <section className="hero section-shell" id="top" aria-labelledby="hero-title">
          <div className="hero-copy">
            <div className="hero-signature">
              <span className="signal-line" />
              为 Emby / Jellyfin 的公网播放而造
            </div>
            <h1 id="hero-title">
              让公网观影
              <br />
              更流畅。
            </h1>
            <p className="hero-lead">
              减少媒体服务器上行带宽对播放的限制。通过 Openlist
              获取网盘直链，让视频直接到达客户端，保留熟悉的媒体库与播放器。
            </p>
            <p className="hero-condition">
              本地有视频文件，或只有 STRM 等媒体条目，都可通过路径映射或解析关联 Openlist 中的文件。
            </p>
            <div className="hero-actions">
              <a className="key primary-key" href="#quick-start">
                快速开始 <Arrow />
              </a>
              <a className="key" href={repository}>
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
            <div className="scenario-switch" role="group" aria-label="切换媒体库场景">
              {(["local", "strm"] as const).map((item) => (
                <button key={item} type="button" aria-pressed={scenario === item} onClick={() => setScenario(item)}>
                  <span className="choice-dot" />
                  {scenarios[item].title}
                </button>
              ))}
            </div>
            <FlowDiagram scenario={scenario} />
            <p className="flow-fallback">直链解析失败时回退上游代理；能否继续播放取决于上游媒体是否可用。</p>
          </div>
        </section>
        <div className="compatibility-strip section-shell">
          <span>和你的媒体库一起工作</span>
          <div>
            <strong>Emby</strong>
            <span>/</span>
            <strong>Jellyfin</strong>
            <span>+</span>
            <strong>Openlist</strong>
          </div>
          <span className="strip-end">请求中继，而非另一套媒体服务。</span>
        </div>
        <section className="scenarios-section section-shell" id="scenarios" aria-labelledby="scenarios-title">
          <div className="section-heading">
            <h2 id="scenarios-title">
              两种媒体库。
              <br />
              同一条直达路线。
            </h2>
            <p>
              本地有没有视频实体文件，
              <br />
              不是使用直链的分界线。
            </p>
          </div>
          <div className="scenario-stories">
            {(["local", "strm"] as const).map((item, index) => (
              <article key={item}>
                <div className="story-heading">
                  <span className="story-number">0{index + 1}</span>
                  <span>{index === 0 ? "已有视频，也有网盘副本" : "只留条目，不落地完整视频"}</span>
                </div>
                <h3>{scenarios[item].title}</h3>
                <p>{scenarios[item].description}</p>
                <div className="path-example">
                  <span>{item === "local" ? "/media/电影.mkv" : "电影.strm / 媒体条目"}</span>
                  <Arrow />
                  <span>Openlist</span>
                  <Arrow />
                  <strong>网盘直链</strong>
                </div>
                <a className="text-link" href="#top" onClick={() => setScenario(item)}>
                  查看这个场景的播放链路 <Arrow />
                </a>
              </article>
            ))}
          </div>
          <p className="scenario-caveat">
            共同前提：媒体服务中存在有效条目，Openlist 可访问对应文件，客户端能够访问最终直链。
          </p>
        </section>
        <ProductTour />
        <QuickStart />
        <section className="faq-section section-shell" id="faq" aria-labelledby="faq-title">
          <div>
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
                  {question}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <footer className="footer section-shell">
        <div className="footer-main">
          <a className="brand" href="#top">
            <Mark />
            <span>MediaRelay</span>
          </a>
          <p>为公网观看，连接更直接的播放路径。</p>
          <a className="text-link" href="#quick-start">
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
