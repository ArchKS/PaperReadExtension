// ai coding: 实现文章提取、隔离阅读界面、黑白主题与阅读偏好交互 2026/11/05: 09:24
(() => {
  "use strict";

  if (window.__readModeController) {
    window.__readModeController.toggle();
    return;
  }

  const demo = document.documentElement.dataset.readmodeDemo === "true";
  const scriptURL = document.currentScript?.src;
  const hasExtension = typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
  // ai coding: 更新目录旁图片图标的预览样式版本 2026/11/06: 14:33
  const styleURL = hasExtension
    ? chrome.runtime.getURL("reader.css")
    : new URL("reader.css?v=1.5.1", scriptURL || location.href).href;
  // ai coding: 新增默认显示图片偏好并保留现有阅读排版设置 2026/11/06: 14:28
  const defaults = { theme: "white", font: "serif", size: 21, width: "standard", contentWidth: 720, paper: "plain", texture: 35, paragraphGap: 24, lineHeight: 1.95, showImages: true, toc: true };
  // ai coding: 统一将字号下限设为十二像素并保留原字号上限 2026/11/05: 10:01
  const fontSizeLimits = { min: 12, max: 28 };
  const presetWidths = { narrow: 600, standard: 720, wide: 850 };
  // ai coding: 在宽松排版无法容纳侧栏时改用浮动目录 2026/11/05: 09:30
  const SIDEBAR_BREAKPOINT = 1340;
  // ai coding: 移除文章页尾专用的原文跳转图标 2026/11/05: 09:41
  const icons = {
    book: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5.5C8.5 3.5 5 4 3 5v14c3-1.5 6-1.5 9 .5 3-2 6-2 9-.5V5c-2-1-5.5-1.5-9 .5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 5.5v14" stroke="currentColor" stroke-width="1.5"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    toc: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M9 5v14M13 9h4M13 13h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    // ai coding: 增加图片图标与关闭时的斜线状态 2026/11/06: 14:33
    images: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" stroke-width="1.5"/><circle cx="8.5" cy="9.5" r="1.5" stroke="currentColor" stroke-width="1.5"/><path d="m4 17 5-5 4 4 3-3 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path class="image-off-stroke" d="m3 3 18 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 12 6-6 6 6M12 6v12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    clock: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.75" stroke="currentColor"/><path d="M8 4.5V8l2.5 1.5" stroke="currentColor" stroke-linecap="round"/></svg>',
  };
  let preferences = { ...defaults };
  let host = null;
  let shadow = null;
  let viewport = null;
  let isOpening = false;
  let openRequested = true;
  let articleCache = null;
  let cssPromise = null;
  let cleanup = [];
  let previousFocus = null;
  let previousOverflow = null;
  // ai coding: 记录原网页可交互状态以便退出阅读时恢复 2026/11/05: 09:26
  let previousBodyInert = false;
  let previousReaderScroll = 0;
  // ai coding: 按文章身份区分阅读位置避免单页应用串用进度 2026/11/05: 09:27
  let previousArticleKey = "";
  let headings = [];
  // ai coding: 记录摘录文字与分享卡片渲染状态并隔离过期预览请求 2026/11/05: 13:21
  const shareState = { quote: "", theme: "white", token: 0, canvas: null, returnFocus: null, inert: new Map() };

  // ai coding: 支持保存和读取十二像素字号并保留既有纸张排版偏好 2026/11/05: 10:01
  function validPreferences(value) {
    const source = value && typeof value === "object" ? value : {};
    const width = Object.hasOwn(presetWidths, source.width) ? source.width : defaults.width;
    return {
      theme: ["white", "black"].includes(source.theme) ? source.theme : defaults.theme,
      font: ["serif", "sans"].includes(source.font) ? source.font : defaults.font,
      size: Number.isFinite(source.size) ? Math.max(fontSizeLimits.min, Math.min(fontSizeLimits.max, source.size)) : defaults.size,
      width,
      contentWidth: Number.isFinite(source.contentWidth) ? Math.max(280, Math.min(1000, source.contentWidth)) : presetWidths[width],
      paper: ["plain", "grain", "parchment"].includes(source.paper) ? source.paper : defaults.paper,
      texture: Number.isFinite(source.texture) ? Math.max(0, Math.min(100, source.texture)) : defaults.texture,
      paragraphGap: Number.isFinite(source.paragraphGap) ? Math.max(8, Math.min(64, source.paragraphGap)) : defaults.paragraphGap,
      // ai coding: 校验持久化行距并为旧版偏好补充默认值 2026/11/05: 10:31
      lineHeight: Number.isFinite(source.lineHeight) ? Math.max(1.2, Math.min(2.6, source.lineHeight)) : defaults.lineHeight,
      // ai coding: 校验图片开关偏好并让旧版设置继续显示图片 2026/11/06: 14:28
      showImages: typeof source.showImages === "boolean" ? source.showImages : defaults.showImages,
      toc: typeof source.toc === "boolean" ? source.toc : defaults.toc,
    };
  }

  async function loadPreferences() {
    try {
      const value = hasExtension
        ? (await chrome.storage.local.get("readModePreferences")).readModePreferences
        : JSON.parse(localStorage.getItem("readModePreferences") || "null");
      preferences = validPreferences(value);
    } catch {
      preferences = { ...defaults };
    }
  }

  function savePreferences() {
    try {
      if (hasExtension) {
        chrome.storage.local.set({ readModePreferences: preferences }).catch(() => {});
      } else {
        localStorage.setItem("readModePreferences", JSON.stringify(preferences));
      }
    } catch {
      // ai coding: 存储不可用时保留当前会话的阅读设置 2026/11/05: 09:24
    }
  }

  function meta(selector) {
    return document.querySelector(selector)?.content?.trim() || "";
  }

  // ai coding: 分别读取雪球独立昵称字段、发布时间和来源地区以排除隐藏备注与关注按钮 2026/11/05: 13:44
  function pageArticleMetadata() {
    const header = document.querySelector(".article__container .article__author");
    if (!header) return null;
    const name = header.querySelector(".avatar__name .name");
    const nameClone = name?.cloneNode(true);
    nameClone?.querySelectorAll(".user-remark, [hidden], button").forEach((element) => element.remove());
    const published = header.querySelector(".avatar__subtitle time[datetime]");
    const publishedText = published?.getAttribute("title") || published?.textContent.trim() || "";
    const source = header.querySelector(".avatar__subtitle .source")?.textContent.replace(/^\s*来自\s*/, "").trim() || "雪球";
    const region = header.querySelector(".avatar__subtitle > span.time")?.textContent.trim() || "";
    return {
      byline: cleanAuthor(name?.getAttribute("data-screenname") || nameClone?.textContent || ""),
      publishedTime: published?.getAttribute("datetime") || "",
      publishedText: /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(publishedText) ? publishedText : "",
      site: "雪球",
      source: [source, region].filter(Boolean).join(" · "),
    };
  }

  // ai coding: 去除作者文本中的空备注括号与拼接的发布时间而不删除真实昵称内容 2026/11/05: 13:41
  function cleanAuthor(value) {
    return String(value || "").split(/\s*(?:发布于|发表于)\s*(?=\d{4}[-年/])/)[0]
      .replace(/^\s*(?:作者|author)\s*[:：]\s*/i, "").replace(/\(\s*\)|（\s*）/g, "").replace(/\s+/g, " ").trim();
  }

  // ai coding: 以北京时间保留发布时间的日期与时分并让纯日期数据保持纯日期 2026/11/05: 13:41
  function publicationDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return { text: "", iso: "" };
    const withTime = typeof value === "number" || /[T\s]\d{1,2}:\d{2}/.test(String(value));
    const fields = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {}) }).formatToParts(date);
    const part = (name) => fields.find((field) => field.type === name)?.value || "";
    const text = `${part("year")}-${part("month")}-${part("day")}${withTime ? ` ${part("hour")}:${part("minute")}` : ""}`;
    return { text, iso: date.toISOString() };
  }

  // ai coding: 提取正文前独立保存作者元信息并从雪球克隆文档删除作者交互栏 2026/11/05: 13:41
  function extractArticle() {
    const pageMetadata = pageArticleMetadata();
    const clone = document.cloneNode(true);
    clone.getElementById("__readmode_root__")?.remove();
    if (pageMetadata) clone.querySelectorAll(".article__author").forEach((element) => element.remove());
    let article = null;
    if (typeof Readability !== "undefined") {
      try {
        article = new Readability(clone, { charThreshold: 180, keepClasses: false }).parse();
      } catch {
        article = null;
      }
    }
    if (!article || !article.textContent || article.textContent.trim().length < 120) {
      const candidate = document.querySelector("article, [role='main'], main");
      if (candidate && candidate.textContent.trim().length >= 120) {
        const fallback = candidate.cloneNode(true);
        fallback.querySelectorAll("nav, aside, footer, form, script, style, button, input").forEach((element) => element.remove());
        article = {
          title: document.querySelector("h1")?.textContent.trim() || document.title,
          content: fallback.innerHTML,
          textContent: fallback.textContent,
          excerpt: meta('meta[name="description"]'),
          byline: meta('meta[name="author"]'),
        };
      } else {
        return null;
      }
    }
    // ai coding: 识别站点后缀标题并优先使用文章真实标题 2026/11/05: 09:32
    let title = article.title?.trim() || document.title || "未命名文章";
    const headingTitle = (document.querySelector("article h1, main h1") || document.querySelector("h1"))?.textContent.trim();
    if (headingTitle && title !== headingTitle) {
      const suffix = title.startsWith(headingTitle) ? title.slice(headingTitle.length) : "";
      const prefix = title.endsWith(headingTitle) ? title.slice(0, -headingTitle.length) : "";
      if (/^\s*[-—–|·•:»]/.test(suffix) || /[-—–|·•:»]\s*$/.test(prefix)) title = headingTitle;
    }
    // ai coding: 优先采用页面独立字段并保留通用文章元数据的回退 2026/11/05: 13:41
    const site = pageMetadata?.site || article.siteName || meta('meta[property="og:site_name"]') || location.hostname || "本地文章";
    const dateValue = pageMetadata?.publishedTime || article.publishedTime || meta('meta[property="article:published_time"]') || document.querySelector("time[datetime]")?.dateTime;
    const date = dateValue ? publicationDate(dateValue) : { text: "", iso: "" };
    const text = article.textContent || "";
    const chineseCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
    const wordCount = (text.replace(/[\u3400-\u9fff]/g, " ").match(/[\p{L}\p{N}]+/gu) || []).length;
    return {
      title,
      content: article.content,
      // ai coding: 只使用网页声明的摘要避免将首段正文误作副标题 2026/11/05: 09:34
      excerpt: meta('meta[property="og:description"]') || meta('meta[name="description"]'),
      // ai coding: 将作者、来源与完整发布时间作为独立字段传入阅读界面和分享卡片 2026/11/05: 13:41
      byline: pageMetadata?.byline || cleanAuthor(article.byline || meta('meta[name="author"]')),
      site,
      source: pageMetadata?.source || site,
      date: pageMetadata?.publishedText || date.text,
      dateTime: date.iso,
      minutes: Math.max(1, Math.ceil(chineseCount / 350 + wordCount / 220)),
      count: chineseCount ? `${(chineseCount + wordCount).toLocaleString("zh-CN")} 字` : `${wordCount.toLocaleString("zh-CN")} 词`,
      lang: article.lang || document.documentElement.lang || "zh-CN",
    };
  }

  function safeURL(value, image = false) {
    if (!value) return null;
    try {
      const url = new URL(value, document.baseURI);
      if (["https:", "http:"].includes(url.protocol)) return url.href;
      if (!image && url.protocol === "mailto:") return url.href;
      if (image && /^data:image\/(png|jpeg|gif|webp|avif);base64,/i.test(value)) return value;
    } catch {
      return null;
    }
    return null;
  }

  function sanitizeContent(content, article) {
    const parsed = new DOMParser().parseFromString(content, "text/html");
    parsed.querySelectorAll("script, style, link, iframe, object, embed, form, input, button, textarea, select, noscript, template, svg, canvas, audio, video, nav, aside").forEach((element) => element.remove());
    const allowed = new Set(["P", "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "A", "IMG", "FIGURE", "FIGCAPTION", "BLOCKQUOTE", "UL", "OL", "LI", "PRE", "CODE", "EM", "STRONG", "B", "I", "U", "S", "DEL", "INS", "BR", "HR", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TH", "TD", "CAPTION", "SUP", "SUB", "ABBR", "SPAN", "TIME", "DL", "DT", "DD", "MARK", "SMALL"]);
    // ai coding: 去除 Readability 将主标题改成二级标题后产生的重复抬头 2026/11/05: 09:32
    parsed.querySelectorAll("header").forEach((element) => {
      if (element.querySelector("h1, h2")?.textContent.trim() === article.title) element.remove();
    });
    const leadingHeading = parsed.querySelector("h1, h2");
    if (leadingHeading?.textContent.trim() === article.title) leadingHeading.remove();
    parsed.querySelectorAll("h1").forEach((element) => {
      if (element.textContent.trim() === article.title) element.remove();
    });
    const firstParagraph = parsed.querySelector("p");
    if (firstParagraph?.textContent.trim() === article.excerpt) firstParagraph.remove();
    const originalIDs = new Map();
    let idIndex = 0;
    for (const element of [...parsed.body.querySelectorAll("*")]) {
      if (!allowed.has(element.tagName)) {
        element.replaceWith(...element.childNodes);
        continue;
      }
      const oldID = element.getAttribute("id");
      const href = element.getAttribute("href");
      const lazySource = element.getAttribute("data-src") || element.getAttribute("data-original");
      const src = element.getAttribute("src") || lazySource;
      const alt = element.getAttribute("alt");
      const title = element.getAttribute("title");
      const colspan = element.getAttribute("colspan");
      const rowspan = element.getAttribute("rowspan");
      for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
      if (oldID) {
        const newID = `readmode-anchor-${idIndex++}`;
        originalIDs.set(oldID, newID);
        element.id = newID;
      }
      if (element.tagName === "A") {
        if (href?.startsWith("#")) {
          element.dataset.originalAnchor = href.slice(1);
        } else {
          const url = safeURL(href);
          if (url) {
            element.href = url;
            element.target = "_blank";
            element.rel = "noopener noreferrer";
          }
        }
      }
      if (element.tagName === "IMG") {
        const url = safeURL(src, true);
        if (!url) { element.remove(); continue; }
        element.src = url;
        element.alt = alt || "";
        element.loading = "lazy";
        element.decoding = "async";
        element.referrerPolicy = "no-referrer";
      }
      if (title) element.title = title;
      if (["TD", "TH"].includes(element.tagName)) {
        if (/^[1-9]\d?$/.test(colspan || "")) element.setAttribute("colspan", colspan);
        if (/^[1-9]\d?$/.test(rowspan || "")) element.setAttribute("rowspan", rowspan);
      }
    }
    // ai coding: 将微信等网页的纯文字 section 与 div 转为段落并保留嵌套结构和锚点 2026/11/05: 10:45
    const paragraphContainers = "p, div, section, article, header, footer, h1, h2, h3, h4, h5, h6, blockquote, ul, ol, li, pre, table, dl, figure, hr";
    for (const element of [...parsed.querySelectorAll("section, div")].reverse()) {
      if (!element.textContent.trim() || element.querySelector(paragraphContainers)) continue;
      const paragraph = parsed.createElement("p");
      for (const attribute of [...element.attributes]) paragraph.setAttribute(attribute.name, attribute.value);
      paragraph.append(...element.childNodes);
      element.replaceWith(paragraph);
    }
    parsed.querySelectorAll("a[data-original-anchor]").forEach((anchor) => {
      const target = originalIDs.get(anchor.dataset.originalAnchor);
      if (target) anchor.href = `#${target}`;
      delete anchor.dataset.originalAnchor;
    });
    // ai coding: 正文挂载前将图片暂存为惰性内容以支持不渲染图片 2026/11/06: 14:28
    prepareArticleImages(parsed.body);
    return document.importNode(parsed.body, true);
  }

  // ai coding: 暂存安全图片并标记纯图片容器与图注以避免隐藏后留下空白 2026/11/06: 14:28
  function prepareArticleImages(body) {
    body.querySelectorAll("img").forEach((image) => {
      const slot = body.ownerDocument.createElement("span");
      slot.className = "reader-image-slot";
      slot.hidden = true;
      const template = body.ownerDocument.createElement("template");
      image.replaceWith(slot);
      template.content.append(image);
      slot.append(template);
    });
    body.querySelectorAll("figure, p, a, div, section").forEach((element) => {
      if (!element.querySelector(".reader-image-slot")) return;
      if (element.tagName === "FIGURE") {
        element.querySelectorAll("figcaption").forEach((caption) => {
          caption.dataset.readmodeImageCaption = "";
        });
      }
      const textOnly = element.cloneNode(true);
      textOnly.querySelectorAll(".reader-image-slot, figcaption").forEach((node) => node.remove());
      if (!textOnly.textContent.trim() && !textOnly.querySelector("hr, table")) {
        element.dataset.readmodeImageOnly = "";
      }
    });
  }

  // ai coding: 按图片偏好挂载或移回惰性模板并同步隐藏纯图片容器和图注 2026/11/06: 14:28
  function syncArticleImages() {
    const content = shadow.querySelector(".article-content");
    if (!content) return;
    content.querySelectorAll(".reader-image-slot").forEach((slot) => {
      const template = slot.querySelector("template");
      if (preferences.showImages) {
        slot.append(...template.content.childNodes);
      } else {
        const image = slot.querySelector("img");
        if (image) template.content.append(image);
      }
      slot.hidden = !preferences.showImages;
    });
    content.querySelectorAll("[data-readmode-image-only], [data-readmode-image-caption]").forEach((element) => {
      element.hidden = !preferences.showImages;
    });
  }

  function listen(target, event, handler, options) {
    target.addEventListener(event, handler, options);
    cleanup.push(() => target.removeEventListener(event, handler, options));
  }

  function setText(selector, text) {
    const element = shadow.querySelector(selector);
    if (element) element.textContent = text;
  }

  // ai coding: 应用纸张质感与精确排版数值并同步设置控件和页边距说明 2026/11/05: 09:52
  function applyPreferences() {
    if (!shadow) return;
    const shell = shadow.querySelector(".reader-shell");
    shell.dataset.theme = preferences.theme;
    shell.dataset.font = preferences.font;
    shell.dataset.width = preferences.width;
    // ai coding: 应用图片可见状态并同步工具栏图标的按下状态 2026/11/06: 14:33
    syncArticleImages();
    shadow.querySelector(".images-toggle").setAttribute("aria-pressed", String(preferences.showImages));
    shell.dataset.paper = preferences.paper;
    shell.dataset.sidebarMode = isFloatingSidebar() ? "floating" : "inline";
    if (!isFloatingSidebar()) shell.classList.remove("mobile-toc-open");
    shell.dataset.toc = String(preferences.toc && headings.length > 0);
    // ai coding: 设置统一正文字号供所有文章标题按增加四像素计算 2026/11/05: 10:10
    shell.style.setProperty("--reading-size", `${preferences.size}px`);
    shell.style.setProperty("--content-width", `${preferences.contentWidth}px`);
    shell.style.setProperty("--paragraph-gap", `${preferences.paragraphGap}px`);
    // ai coding: 实时应用正文行距倍数以同步改变段内每行距离 2026/11/05: 10:31
    shell.style.setProperty("--reading-line-height", String(preferences.lineHeight));
    shell.style.setProperty("--paper-texture-opacity", preferences.paper === "plain" ? "0" : String(preferences.texture / 100 * 0.18));
    shadow.querySelectorAll("[data-theme-choice]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.themeChoice === preferences.theme)));
    shadow.querySelectorAll("[data-font-choice]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.fontChoice === preferences.font)));
    shadow.querySelectorAll("[data-width-choice]").forEach((button) => button.setAttribute("aria-pressed", String(presetWidths[button.dataset.widthChoice] === preferences.contentWidth)));
    shadow.querySelectorAll("[data-paper-choice]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.paperChoice === preferences.paper)));
    shadow.querySelectorAll("input[data-layout]").forEach((input) => {
      input.value = String(preferences[input.dataset.layout]);
      if (input.dataset.layout === "texture") input.disabled = preferences.paper === "plain";
    });
    setText(".texture-value", `${preferences.texture}%`);
    setText(".gap-value", `${preferences.paragraphGap} px`);
    // ai coding: 显示当前行距倍数并与滑块同步 2026/11/05: 10:31
    setText(".line-height-value", `${preferences.lineHeight.toFixed(2)} 倍`);
    setText(".width-value", `${preferences.contentWidth} px`);
    const tocButton = shadow.querySelector(".toc-toggle");
    // ai coding: 根据桌面与移动目录实际状态同步辅助技术属性 2026/11/05: 09:27
    syncTocState();
    tocButton.disabled = !headings.length;
    tocButton.title = headings.length ? "显示或隐藏目录" : "这篇文章没有章节标题";
    // ai coding: 同步两个字号入口并在十二像素下禁用继续缩小 2026/11/05: 10:01
    shadow.querySelectorAll(".size-value").forEach((element) => { element.textContent = `${preferences.size}`; });
    shadow.querySelectorAll('[data-size="minus"]').forEach((button) => { button.disabled = preferences.size <= fontSizeLimits.min; });
    shadow.querySelectorAll('[data-size="plus"]').forEach((button) => { button.disabled = preferences.size >= fontSizeLimits.max; });
    updateProgress();
    updatePageMargins();
  }

  // ai coding: 按实际内容宽度决定目录布局并显示正文到页面边缘的距离 2026/11/05: 09:52
  function isFloatingSidebar() {
    return innerWidth < Math.max(SIDEBAR_BREAKPOINT, preferences.contentWidth + 520);
  }

  function updatePageMargins() {
    if (!viewport || !shadow) return;
    const contentWidth = shadow.querySelector(".reader-main").getBoundingClientRect().width;
    const margin = Math.max(0, (viewport.clientWidth - contentWidth) / 2);
    setText(".margin-value", `当前正文 ${Math.round(contentWidth)} px · 两侧页边距 ${Math.round(margin)} px`);
  }

  function updateProgress() {
    if (!viewport) return;
    const distance = viewport.scrollHeight - viewport.clientHeight;
    const progress = distance > 0 ? Math.min(1, Math.max(0, viewport.scrollTop / distance)) : 1;
    shadow.querySelector(".progress-fill").style.width = `${progress * 100}%`;
    setText(".progress-number", `${Math.round(progress * 100)}%`);
    const progressElement = shadow.querySelector(".reading-progress");
    progressElement.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
    // ai coding: 隐藏回到顶部按钮时将其移出键盘焦点序列 2026/11/05: 09:26
    const backTop = shadow.querySelector(".back-top");
    const showBackTop = viewport.scrollTop > 350;
    backTop.classList.toggle("visible", showBackTop);
    backTop.tabIndex = showBackTop ? 0 : -1;
    backTop.setAttribute("aria-hidden", String(!showBackTop));
    let active = 0;
    const top = viewport.getBoundingClientRect().top;
    headings.forEach((heading, index) => {
      if (heading.getBoundingClientRect().top - top < 180) active = index;
    });
    // ai coding: 正文到达底部时激活末章目录避免删除页尾后无法对齐章节 2026/11/05: 09:43
    if (distance > 0 && progress >= 0.999 && headings.length) active = headings.length - 1;
    shadow.querySelectorAll(".toc-link").forEach((link, index) => {
      link.classList.toggle("active", index === active);
      if (index === active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  }

  function closeSettings(returnFocus = false) {
    const panel = shadow?.querySelector(".settings-panel");
    if (!panel || panel.hidden) return false;
    panel.hidden = true;
    const button = shadow.querySelector(".settings-toggle");
    button.setAttribute("aria-expanded", "false");
    if (returnFocus) button.focus();
    return true;
  }

  function scrollToElement(element) {
    if (!element || !viewport) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    viewport.scrollTo({ top: element.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop - 48, behavior: reduced ? "instant" : "smooth" });
    if (isFloatingSidebar()) {
      shadow.querySelector(".reader-shell").classList.remove("mobile-toc-open");
      // ai coding: 跳转章节后同步移动目录的关闭状态 2026/11/05: 09:27
      syncTocState();
    }
  }

  // ai coding: 按可调正文宽度同步浮动目录和固定侧栏的展开状态 2026/11/05: 09:52
  function syncTocState() {
    if (!shadow) return;
    const button = shadow.querySelector(".toc-toggle");
    if (isFloatingSidebar()) {
      button.removeAttribute("aria-pressed");
      button.setAttribute("aria-expanded", String(shadow.querySelector(".reader-shell").classList.contains("mobile-toc-open")));
    } else {
      button.removeAttribute("aria-expanded");
      button.setAttribute("aria-pressed", String(preferences.toc));
    }
  }

  // ai coding: 分享卡片打开时将焦点约束在卡片编辑器并支持文本输入 2026/11/05: 13:21
  function trapDialogFocus(event) {
    if (event.key !== "Tab" || !shadow) return;
    const scope = shadow.querySelector('.share-overlay:not([hidden]) .share-dialog') || shadow;
    const controls = [...scope.querySelectorAll('button:not(:disabled):not([tabindex="-1"]), input:not(:disabled):not([tabindex="-1"]), textarea:not(:disabled), a[href], [tabindex="0"]')]
      .filter((element) => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
    const active = shadow.activeElement;
    if (event.shiftKey && (active === controls[0] || !controls.includes(active))) {
      event.preventDefault(); controls.at(-1)?.focus();
    }
    if (!event.shiftKey && (active === controls.at(-1) || !controls.includes(active))) {
      event.preventDefault(); controls[0]?.focus();
    }
  }

  // ai coding: 移除选区浮动入口并仅通过右上角分享按钮生成卡片 2026/11/05: 13:32
  function bindShareControls(content, article) {
    const toolbarButton = shadow.querySelector(".share-selection");
    const overlay = shadow.querySelector(".share-overlay");
    const field = shadow.querySelector(".share-text");
    const status = shadow.querySelector(".share-status");
    const download = shadow.querySelector(".share-download");
    const copy = shadow.querySelector(".share-copy");
    let timer;
    function message(text, error = false) {
      status.textContent = text;
      status.classList.toggle("is-error", error);
    }
    async function preview() {
      if (overlay.hidden) return;
      const token = ++shareState.token;
      download.disabled = true; copy.disabled = true; shareState.canvas = null;
      message("正在生成…");
      try {
        if (!window.__readModeShareCard) throw new Error("分享组件尚未加载，请刷新网页后重试。");
        // ai coding: 将独立作者来源和当前阅读字体排版传入分享卡片 2026/11/05: 13:50
        const readingStyle = getComputedStyle(content);
        const canvas = await window.__readModeShareCard.render({ text: field.value, title: article.title, author: article.byline || "", source: article.source || article.site, url: location.href, theme: shareState.theme, fontFamily: readingStyle.fontFamily, fontSize: parseFloat(readingStyle.fontSize), fontWeight: readingStyle.fontWeight });
        if (!shadow || token !== shareState.token || overlay.hidden) return;
        shadow.querySelector(".share-preview").replaceChildren(canvas);
        shareState.canvas = canvas;
        download.disabled = false; copy.disabled = false;
        message("右下角二维码可打开原文");
      } catch (error) {
        if (token === shareState.token && !overlay.hidden) {
          shadow.querySelector(".share-preview").replaceChildren();
          message(error.message || "生成失败，请重试。", true);
        }
      }
    }
    // ai coding: 选取文字时仅记录摘录并启用 Header 分享按钮 2026/11/05: 13:32
    function capture() {
      if (!overlay.hidden) return;
      const selection = typeof shadow.getSelection === "function" ? shadow.getSelection() : window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount || !content.contains(selection.anchorNode) || !content.contains(selection.focusNode)) {
        return;
      }
      const text = selection.toString().trim();
      if (!text) return;
      shareState.quote = text;
      toolbarButton.disabled = false;
    }
    // ai coding: Header 入口直接打开卡片编辑器而不操作选区浮动按钮 2026/11/05: 13:32
    function openCard() {
      if (!shareState.quote) return;
      closeSettings();
      shareState.returnFocus = shadow.activeElement;
      field.value = shareState.quote;
      overlay.hidden = false;
      for (const element of shadow.querySelector(".reader-shell").children) {
        if (element === overlay) continue;
        shareState.inert.set(element, element.inert);
        element.inert = true;
      }
      setText(".share-source", article.title);
      // ai coding: 重新打开卡片时同步配色按钮与实际预览 2026/11/05: 13:24
      shadow.querySelectorAll("[data-share-theme]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.shareTheme === shareState.theme)));
      field.focus({ preventScroll: true });
      preview();
    }
    // ai coding: 保留 Header 点击前的正文选区并移除浮动按钮定位监听 2026/11/05: 13:32
    listen(toolbarButton, "mousedown", (event) => event.preventDefault());
    listen(toolbarButton, "click", openCard);
    listen(document, "selectionchange", capture);
    listen(content, "pointerup", () => queueMicrotask(capture));
    listen(content, "keyup", capture);
    listen(shadow.querySelector(".share-close"), "click", () => closeShareCard());
    listen(overlay, "click", (event) => { if (event.target === overlay) closeShareCard(); });
    listen(field, "input", () => {
      clearTimeout(timer); shareState.token++; shareState.canvas = null;
      download.disabled = true; copy.disabled = true;
      timer = setTimeout(preview, 120);
    });
    shadow.querySelectorAll("[data-share-theme]").forEach((button) => listen(button, "click", () => {
      shareState.theme = button.dataset.shareTheme;
      shadow.querySelectorAll("[data-share-theme]").forEach((choice) => choice.setAttribute("aria-pressed", String(choice === button)));
      preview();
    }));
    listen(download, "click", () => {
      const canvas = shareState.canvas;
      if (!canvas) return;
      canvas.toBlob((blob) => {
        if (!blob) { message("图片保存失败，请重试。", true); return; }
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${article.title.replace(/[\\/:*?"<>|]/g, "").slice(0, 50) || "ReadMode"}-摘录.png`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        message("图片已下载");
      }, "image/png");
    });
    listen(copy, "click", async () => {
      const canvas = shareState.canvas;
      if (!canvas) return;
      try {
        if (!navigator.clipboard?.write || typeof ClipboardItem !== "function") throw new Error("请使用下载 PNG 保存图片。");
        const blob = new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("图片生成失败，请重试。")), "image/png"));
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        message("图片已复制，可粘贴到聊天或笔记中");
      } catch { message("复制未成功，请使用下载 PNG 保存图片。", true); }
    });
    cleanup.push(() => clearTimeout(timer));
  }

  // ai coding: 关闭分享编辑器时恢复阅读交互及原有焦点 2026/11/05: 13:21
  function closeShareCard() {
    const overlay = shadow?.querySelector(".share-overlay");
    if (!overlay || overlay.hidden) return false;
    overlay.hidden = true;
    shareState.token++;
    for (const [element, inert] of shareState.inert) element.inert = inert;
    shareState.inert.clear();
    const focus = shareState.returnFocus;
    if (focus?.isConnected && !focus.hidden) focus.focus({ preventScroll: true });
    else viewport?.focus({ preventScroll: true });
    return true;
  }

  // ai coding: 增加纸张主题、纹理强度与段落间距和内容宽度设置界面 2026/11/05: 09:52
  function renderArticle(article) {
    shadow.innerHTML = `<style></style>
      <section class="reader-shell" role="dialog" aria-modal="true" aria-label="ReadMode 阅读模式" tabindex="-1">
        <header class="toolbar">
          <div class="brand"><span class="brand-icon">${icons.book}</span><span>ReadMode</span></div>
          <div class="toolbar-actions">
            <button class="icon-button toc-toggle" aria-label="显示或隐藏目录" aria-controls="readmode-toc" aria-pressed="true" title="显示或隐藏目录">${icons.toc}</button>
            <!-- ai coding: 将图片切换图标放在目录按钮右侧 2026/11/06: 14:33 -->
            <button class="icon-button images-toggle" aria-label="显示图片" aria-pressed="true">${icons.images}</button>
            <span class="toolbar-separator"></span>
            <div class="quick-themes" role="group" aria-label="阅读主题"><button class="theme-swatch white-swatch" data-theme-choice="white" aria-label="白色主题" title="白色主题"><span></span></button><button class="theme-swatch black-swatch" data-theme-choice="black" aria-label="黑色主题" title="黑色主题"><span></span></button></div>
            <span class="toolbar-separator"></span>
            <div class="quick-size" role="group" aria-label="调整字号"><button class="icon-button" data-size="minus" aria-label="减小字号" title="减小字号">A−</button><span class="size-value" aria-label="当前字号" aria-live="polite"></span><button class="icon-button" data-size="plus" aria-label="增大字号" title="增大字号">A＋</button></div>
            <span class="toolbar-separator size-separator"></span>
            <div class="settings-wrap">
              <button class="icon-button settings-toggle" aria-label="阅读设置" aria-haspopup="dialog" aria-expanded="false" aria-controls="readmode-settings" title="字体与排版"><span class="type-icon">Aa</span></button>
              <div class="settings-panel" id="readmode-settings" role="dialog" aria-label="阅读设置" hidden>
                <div class="settings-heading">阅读设置<span>为你，留一点空间</span></div>
                <div class="setting-row"><span>字号</span><div class="size-control"><button data-size="minus" aria-label="减小字号">A−</button><span class="size-value"></span><button data-size="plus" aria-label="增大字号">A＋</button></div></div>
                <div class="setting-block"><span class="setting-label">字体</span><div class="segmented"><button data-font-choice="serif" class="serif-choice">衬线</button><button data-font-choice="sans">无衬线</button></div></div>
                <div class="setting-block"><span class="setting-label">纸张质感</span><div class="segmented"><button data-paper-choice="plain">纯净</button><button data-paper-choice="grain">纤维纸</button><button data-paper-choice="parchment">羊皮纸</button></div></div>
                <div class="setting-block"><div class="setting-control"><label for="readmode-texture">质感强度</label><output class="texture-value" for="readmode-texture"></output></div><input class="setting-range" id="readmode-texture" data-layout="texture" type="range" min="0" max="100" step="5"></div>
                <!-- ai coding: 新增段内行距滑块并明确其调整每行距离 2026/11/05: 10:31 -->
                <div class="setting-block"><div class="setting-control"><label for="readmode-line-height">行距</label><output class="line-height-value" for="readmode-line-height"></output></div><input class="setting-range" id="readmode-line-height" data-layout="lineHeight" type="range" min="1.2" max="2.6" step="0.05"><p class="setting-help">调整同一段中每行文字的距离</p></div>
                <div class="setting-block"><div class="setting-control"><label for="readmode-gap">段落间距</label><output class="gap-value" for="readmode-gap"></output></div><input class="setting-range" id="readmode-gap" data-layout="paragraphGap" type="range" min="8" max="64" step="2"></div>
                <div class="setting-block"><div class="setting-control"><label for="readmode-width">内容宽度</label><output class="width-value" for="readmode-width"></output></div><input class="setting-range" id="readmode-width" data-layout="contentWidth" type="range" min="280" max="1000" step="10"><div class="segmented width-presets"><button data-width-choice="narrow">紧凑</button><button data-width-choice="standard">适中</button><button data-width-choice="wide">宽松</button></div><p class="setting-help margin-value"></p></div>
                <button class="reset-settings">恢复默认设置</button>
              </div>
            </div>
            <span class="toolbar-separator close-separator"></span>
            <!-- ai coding: 增加选区分享工具栏入口并在未选正文时禁用 2026/11/05: 13:21 -->
            <button class="icon-button share-selection" aria-label="将选中文字生成分享卡片" title="选取正文后生成分享卡片" disabled><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 15V3m0 0L8 7m4-4 4 4M7 10H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
            <button class="icon-button close-reader" aria-label="退出阅读模式" title="退出阅读模式 · Esc">${icons.close}</button>
          </div>
        </header>
        <div class="reading-progress" role="progressbar" aria-label="文章阅读进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="progress-fill"></div></div>
        <svg class="paper-texture" aria-hidden="true" focusable="false" width="100%" height="100%"><defs><filter id="readmode-paper-noise" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="3" seed="8" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><pattern id="readmode-paper-pattern" width="160" height="160" patternUnits="userSpaceOnUse"><rect width="160" height="160" filter="url(#readmode-paper-noise)"/></pattern></defs><rect width="100%" height="100%" fill="url(#readmode-paper-pattern)"/></svg>
        <div class="reader-viewport" tabindex="0" aria-label="文章内容">
          <div class="reading-layout">
            <aside class="reader-sidebar" id="readmode-toc"><nav aria-label="文章目录"><div class="toc-heading">本文目录</div><ol class="toc-list"></ol></nav><div class="sidebar-note"><span class="note-line"></span><span>慢一点，也很好。</span></div></aside>
            <main class="reader-main">
              <header class="article-header">
                <div class="article-kicker"><span class="kicker-dot"></span><span class="site-name"></span><span class="demo-label" ${demo ? "" : "hidden"}>体验文章</span></div>
                <h1 class="article-title"></h1><p class="article-deck"></p>
                <!-- ai coding: 以作者发布时间来源三个标签展示元信息并移除分隔圆点 2026/11/05: 13:41 -->
                <div class="article-meta"><span class="meta-field author-field"><span class="meta-label">作者：</span><span class="author-name"></span></span><time class="meta-field date-field"><span class="meta-label">发布于：</span><span class="article-date"></span></time><span class="meta-field source-field"><span class="meta-label">来自：</span><span class="article-source"></span></span></div>
              </header>
              <article class="article-content"></article>
            </main>
            <div class="right-gutter" aria-hidden="true"></div>
          </div>
        </div>
        <footer class="statusbar"><span class="status-left"><span class="status-dot"></span>专注阅读<span class="status-divider">/</span><span class="word-count"></span></span><span class="status-hint"><kbd>esc</kbd> 退出阅读</span><span class="status-right"><span>已读</span><span class="progress-number">0%</span></span></footer>
        <button class="back-top icon-button" aria-label="回到文章顶部" title="回到顶部">${icons.arrow}</button>
        <!-- ai coding: 删除选区浮动按钮并保留分享卡片编辑下载对话框 2026/11/05: 13:32 -->
        <div class="share-overlay" hidden>
          <section class="share-dialog" role="dialog" aria-modal="true" aria-label="分享卡片" tabindex="-1">
            <header class="share-heading"><div><h2>分享卡片</h2><p>留下一段值得分享的文字</p></div><button class="icon-button share-close" aria-label="关闭分享卡片">${icons.close}</button></header>
            <div class="share-body"><div class="share-preview" aria-label="分享卡片预览"></div><div class="share-editor">
              <label for="readmode-share-text">编辑摘录</label><textarea class="share-text" id="readmode-share-text" rows="7" maxlength="2000"></textarea>
              <div class="share-label">卡片配色</div><div class="share-colors" role="group" aria-label="卡片配色"><button data-share-theme="white" aria-pressed="true"><span class="share-color-white"></span>奶油白</button><button data-share-theme="black" aria-pressed="false"><span class="share-color-black"></span>深夜黑</button></div>
              <div class="share-source-label">原文</div><p class="share-source"></p><p class="share-status" role="status" aria-live="polite"></p>
              <button class="share-download" disabled>下载 PNG</button><button class="share-copy" disabled>复制图片</button>
            </div></div>
          </section>
        </div>
      </section>`;
    setText(".site-name", article.site);
    setText(".article-title", article.title);
    setText(".article-deck", article.excerpt);
    if (!article.excerpt || article.excerpt === article.title) shadow.querySelector(".article-deck").hidden = true;
    // ai coding: 分字段显示作者发布时间和来源并隐藏缺失信息标签 2026/11/05: 13:41
    setText(".author-name", article.byline);
    setText(".article-date", article.date);
    setText(".article-source", article.source);
    shadow.querySelector(".author-field").hidden = !article.byline;
    shadow.querySelector(".date-field").hidden = !article.date;
    if (article.dateTime) shadow.querySelector(".date-field").dateTime = article.dateTime;
    setText(".word-count", article.count);
    const content = shadow.querySelector(".article-content");
    const safeContent = sanitizeContent(article.content, article);
    content.append(...safeContent.childNodes);
    content.lang = article.lang;
    headings = [...content.querySelectorAll("h2, h3")].filter((heading) => heading.textContent.trim());
    const list = shadow.querySelector(".toc-list");
    headings.forEach((heading, index) => {
      if (!heading.id) heading.id = `readmode-heading-${index}`;
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = `#${heading.id}`;
      link.className = `toc-link${heading.tagName === "H3" ? " subheading" : ""}`;
      link.textContent = heading.textContent;
      listen(link, "click", (event) => { event.preventDefault(); scrollToElement(heading); });
      item.append(link);
      list.append(item);
    });
    viewport = shadow.querySelector(".reader-viewport");
    listen(viewport, "scroll", updateProgress, { passive: true });
    listen(content, "click", (event) => {
      const anchor = event.target.closest("a");
      if (anchor?.getAttribute("href")?.startsWith("#")) {
        event.preventDefault();
        scrollToElement(shadow.getElementById(anchor.getAttribute("href").slice(1)));
      }
    });
    // ai coding: 排版与视口尺寸改变时更新阅读进度和实际页边距 2026/11/05: 09:52
    const observer = new ResizeObserver(() => { updateProgress(); updatePageMargins(); });
    observer.observe(viewport);
    observer.observe(content);
    cleanup.push(() => observer.disconnect());
    bindControls();
    // ai coding: 正文提取完成后启用选取分享交互 2026/11/05: 13:21
    bindShareControls(content, article);
    applyPreferences();
  }

  function bindControls() {
    listen(shadow.querySelector(".close-reader"), "click", close);
    listen(shadow.querySelector(".back-top"), "click", () => {
      viewport.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    });
    shadow.querySelectorAll("[data-theme-choice]").forEach((button) => listen(button, "click", () => {
      preferences.theme = button.dataset.themeChoice;
      applyPreferences(); savePreferences();
    }));
    shadow.querySelectorAll("[data-font-choice]").forEach((button) => listen(button, "click", () => {
      preferences.font = button.dataset.fontChoice;
      applyPreferences(); savePreferences();
    }));
    // ai coding: 点击工具栏图片图标切换正文图片并保存偏好 2026/11/06: 14:33
    listen(shadow.querySelector(".images-toggle"), "click", () => {
      preferences.showImages = !preferences.showImages;
      applyPreferences(); savePreferences();
    });
    // ai coding: 将原宽度按钮与像素滑块联动并实时保存纸张排版偏好 2026/11/05: 09:52
    shadow.querySelectorAll("[data-width-choice]").forEach((button) => listen(button, "click", () => {
      preferences.width = button.dataset.widthChoice;
      preferences.contentWidth = presetWidths[preferences.width];
      applyPreferences(); savePreferences();
    }));
    shadow.querySelectorAll("[data-paper-choice]").forEach((button) => listen(button, "click", () => {
      preferences.paper = button.dataset.paperChoice;
      applyPreferences(); savePreferences();
    }));
    shadow.querySelectorAll("input[data-layout]").forEach((input) => listen(input, "input", () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      preferences[input.dataset.layout] = Math.max(Number(input.min), Math.min(Number(input.max), value));
      if (input.dataset.layout === "contentWidth") {
        preferences.width = Object.keys(presetWidths).find((key) => presetWidths[key] === preferences.contentWidth) || "standard";
      }
      applyPreferences(); savePreferences();
    }));
    // ai coding: 字号增减统一使用十二至二十八像素范围并保存标题联动结果 2026/11/05: 10:01
    shadow.querySelectorAll("[data-size]").forEach((button) => listen(button, "click", () => {
      preferences.size = Math.max(fontSizeLimits.min, Math.min(fontSizeLimits.max, preferences.size + (button.dataset.size === "plus" ? 1 : -1)));
      applyPreferences(); savePreferences();
    }));
    listen(shadow.querySelector(".reset-settings"), "click", () => {
      preferences = { ...defaults }; applyPreferences(); savePreferences();
    });
    const settingsButton = shadow.querySelector(".settings-toggle");
    const settingsPanel = shadow.querySelector(".settings-panel");
    listen(settingsButton, "click", () => {
      const expanded = settingsPanel.hidden;
      settingsPanel.hidden = !expanded;
      settingsButton.setAttribute("aria-expanded", String(expanded));
      if (expanded) settingsPanel.querySelector("button").focus();
    });
    listen(shadow, "click", (event) => {
      if (!event.target.closest(".settings-wrap")) closeSettings();
    });
    listen(shadow.querySelector(".toc-toggle"), "click", () => {
      if (isFloatingSidebar()) {
        shadow.querySelector(".reader-shell").classList.toggle("mobile-toc-open");
        // ai coding: 移动目录开关同步实际展开状态 2026/11/05: 09:27
        syncTocState();
      } else {
        preferences.toc = !preferences.toc;
        applyPreferences(); savePreferences();
      }
    });
    listen(document, "keydown", (event) => {
      if (!host) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation();
        // ai coding: 优先关闭分享卡片并保留当前阅读模式 2026/11/05: 13:21
        if (closeShareCard()) return;
        if (!closeSettings(true)) {
          const shell = shadow.querySelector(".reader-shell");
          // ai coding: 关闭移动目录时更新辅助技术状态并保留阅读层 2026/11/05: 09:27
          if (shell.classList.contains("mobile-toc-open")) {
            shell.classList.remove("mobile-toc-open");
            syncTocState();
          } else close();
        }
      }
      // ai coding: 使用通用阅读对话框键盘焦点约束 2026/11/05: 09:26
      trapDialogFocus(event);
    }, true);
    listen(window, "resize", () => {
      // ai coding: 视口变化后根据当前内容宽度重新应用侧栏布局与页边距 2026/11/05: 09:52
      shadow.querySelector(".reader-shell").dataset.sidebarMode = isFloatingSidebar() ? "floating" : "inline";
      if (!isFloatingSidebar()) shadow.querySelector(".reader-shell").classList.remove("mobile-toc-open");
      // ai coding: 视口跨越响应式断点时重新同步目录按钮语义 2026/11/05: 09:27
      syncTocState();
      updateProgress();
      updatePageMargins();
    }, { passive: true });
  }

  function renderEmpty() {
    shadow.innerHTML = `<style></style><section class="reader-shell empty-shell" role="dialog" aria-modal="true" aria-label="阅读模式提示"><button class="icon-button empty-close" aria-label="退出阅读模式">${icons.close}</button><div class="empty-state"><div class="empty-icon">${icons.book}</div><p class="empty-eyebrow">READMODE</p><h1>这里还没有可读的文章</h1><p>打开一篇新闻、博客或长文，<br>再点击 ReadMode，开始安静地阅读。</p><button class="empty-return">返回原网页</button><span class="empty-tip">阅读模式适用于有连续正文的页面</span></div></section>`;
    shadow.querySelector(".reader-shell").dataset.theme = preferences.theme;
    listen(shadow.querySelector(".empty-close"), "click", close);
    listen(shadow.querySelector(".empty-return"), "click", close);
    listen(document, "keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close(); }
      // ai coding: 空文章提示同样保留键盘焦点在阅读界面内 2026/11/05: 09:26
      trapDialogFocus(event);
    }, true);
  }

  async function open() {
    if (host || isOpening) return;
    isOpening = true;
    openRequested = true;
    try {
      const [, css] = await Promise.all([
        loadPreferences(),
        cssPromise || (cssPromise = fetch(styleURL).then((response) => {
          if (!response.ok) throw new Error("阅读样式加载失败");
          return response.text();
        }).catch((error) => { cssPromise = null; throw error; })),
      ]);
      if (!openRequested) return;
      articleCache = extractArticle();
      // ai coding: 切换到另一篇文章时从顶部开始阅读 2026/11/05: 09:27
      const articleKey = `${location.href}\n${articleCache?.title || ""}`;
      if (articleKey !== previousArticleKey) previousReaderScroll = 0;
      previousArticleKey = articleKey;
      previousFocus = document.activeElement;
      // ai coding: 阅读层开启期间阻止原网页获得焦点与辅助阅读访问 2026/11/05: 09:26
      previousBodyInert = document.body?.inert || false;
      if (document.body) document.body.inert = true;
      previousOverflow = {
        value: document.documentElement.style.getPropertyValue("overflow"),
        priority: document.documentElement.style.getPropertyPriority("overflow"),
      };
      host = document.createElement("div");
      host.id = "__readmode_root__";
      host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;display:block!important;width:100vw!important;height:100vh!important;isolation:isolate!important;color-scheme:normal!important;";
      // ai coding: 使用开放影子根使预览中的点击拖动可访问并保留样式隔离 2026/11/05: 10:26
      shadow = host.attachShadow({ mode: "open" });
      document.documentElement.append(host);
      document.documentElement.style.setProperty("overflow", "hidden", "important");
      if (articleCache) renderArticle(articleCache);
      else renderEmpty();
      shadow.querySelector("style").textContent = css;
      const shell = shadow.querySelector(".reader-shell");
      shell.tabIndex = -1;
      shell.focus({ preventScroll: true });
      if (viewport) { viewport.scrollTop = previousReaderScroll; updateProgress(); }
    } catch (error) {
      close();
      console.error("ReadMode:", error);
    } finally {
      isOpening = false;
    }
  }

  function close() {
    openRequested = false;
    if (!host) return;
    // ai coding: 退出阅读时取消旧分享预览并清空选区和编辑器状态 2026/11/05: 13:21
    shareState.token++;
    shareState.quote = "";
    shareState.canvas = null;
    shareState.inert.clear();
    previousReaderScroll = viewport?.scrollTop || 0;
    cleanup.forEach((dispose) => dispose());
    cleanup = [];
    host.remove();
    host = null;
    shadow = null;
    viewport = null;
    headings = [];
    if (previousOverflow?.value) document.documentElement.style.setProperty("overflow", previousOverflow.value, previousOverflow.priority);
    else document.documentElement.style.removeProperty("overflow");
    // ai coding: 恢复打开阅读模式前的原网页交互状态 2026/11/05: 09:26
    if (document.body) document.body.inert = previousBodyInert;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }

  // ai coding: 提供幂等进入阅读接口供连续 aa 快捷键使用 2026/11/05: 09:41
  window.__readModeController = {
    toggle() { if (host || isOpening) close(); else open(); },
    open,
    close,
  };
  if (demo) document.getElementById("demo-open-reader")?.addEventListener("click", () => window.__readModeController.toggle());
  open();
})();
