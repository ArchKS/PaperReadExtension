// ai coding: 本地绘制暖白与深色摘录分享卡片并在右下角生成原文二维码 2026/11/05: 13:20
(() => {
  "use strict";

  const font = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
  const palettes = {
    white: { outside: "#efede8", paper: "#fffdfa", ink: "#242522", muted: "#86867d", line: "#e8e5de", accent: "#ff5a5f" },
    black: { outside: "#171918", paper: "#262a28", ink: "#f5f3ed", muted: "#a5aaa2", line: "#404640", accent: "#ff8588" },
  };

  function wrap(ctx, text, width) {
    const lines = [];
    const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;
    for (const paragraph of text.split(/\r?\n/)) {
      if (!paragraph.trim()) { lines.push(""); continue; }
      const tokens = segmenter ? [...segmenter.segment(paragraph)].map((item) => item.segment) : [...paragraph];
      let line = "";
      for (const token of tokens) {
        if (ctx.measureText(line + token).width <= width) { line += token; continue; }
        // ai coding: 换行时让句末标点与前一个字或英文单词保持在同一行 2026/11/05: 13:27
        if (line.trim() && /^[，。！？；：、）》】」』,.!?;:%]+$/u.test(token)) {
          const ending = line.match(/[A-Za-z0-9]+$/)?.[0] || [...line].at(-1);
          const previous = line.slice(0, -ending.length).trimEnd();
          if (previous) { lines.push(previous); line = ending + token; }
          else line += token;
          continue;
        }
        if (line.trim()) { lines.push(line.trimEnd()); line = ""; }
        if (ctx.measureText(token).width <= width) { line = token.trimStart(); continue; }
        for (const character of token) {
          if (ctx.measureText(line + character).width > width && line) { lines.push(line); line = ""; }
          line += character;
        }
      }
      if (line.trim()) lines.push(line.trimEnd());
    }
    return lines;
  }

  function clippedLines(ctx, text, width, maximum) {
    const lines = wrap(ctx, text, width);
    if (lines.length <= maximum) return lines;
    const result = lines.slice(0, maximum);
    let last = result.at(-1);
    while (ctx.measureText(last + "…").width > width) last = [...last].slice(0, -1).join("");
    result[maximum - 1] = last + "…";
    return result;
  }

  function drawQR(ctx, url, right, top) {
    if (typeof qrcode !== "function") throw new Error("二维码组件尚未加载，请刷新网页后重试。");
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    const count = qr.getModuleCount();
    // ai coding: 长链接二维码仍保持整数像素网格且不会超出右下角区域 2026/11/05: 13:23
    const cell = Math.max(1, Math.floor(240 / (count + 8)));
    const size = (count + 8) * cell;
    const left = right - size;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.roundRect(left - 8, top - 8, size + 16, size + 16, 14); ctx.fill();
    ctx.fillStyle = "#232522";
    for (let row = 0; row < count; row++) {
      for (let column = 0; column < count; column++) {
        if (qr.isDark(row, column)) ctx.fillRect(left + (column + 4) * cell, top + (row + 4) * cell, cell, cell);
      }
    }
    return { left, top, size };
  }

  // ai coding: 接收独立作者字段并保持分享字号小六像素与高清导出 2026/11/05: 13:50
  async function render({ text, title, author = "", source, url, theme = "white", fontFamily = font, fontSize = 21, fontWeight = "400" }) {
    text = text.trim();
    if (!text) throw new Error("请先选取或输入需要分享的文字。");
    if (text.length > 2000) throw new Error("摘录较长，请缩短到 2000 字以内。");
    const articleURL = new URL(url);
    if (!["https:", "http:"].includes(articleURL.protocol)) throw new Error("这篇文章没有可分享的网页链接。");
    articleURL.hash = "";
    await document.fonts.ready;
    const colors = palettes[theme] || palettes.white;
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `分享卡片：${text}。选自《${title}》，右下角二维码打开原文。`);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器暂时无法生成图片，请重试。");
    const pixelRatio = 3;
    const readingSize = Number.isFinite(fontSize) ? Math.max(12, Math.min(28, fontSize)) : 21;
    const shareSize = readingSize - 6;
    const textFont = `${fontWeight} ${shareSize * pixelRatio}px ${fontFamily}`;
    ctx.font = textFont;
    const lines = wrap(ctx, text, 840);
    const lineHeight = shareSize * pixelRatio * 1.56;
    const footerTop = Math.max(740, 300 + lines.length * lineHeight + 72);
    if (footerTop + 350 > 32760) throw new Error("摘录过长，请减少文字或缩小阅读字号后重试。");
    canvas.height = footerTop + 350;
    ctx.fillStyle = colors.outside; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.shadowColor = theme === "black" ? "#00000022" : "#48423912";
    ctx.shadowBlur = 28; ctx.shadowOffsetY = 12;
    ctx.fillStyle = colors.paper;
    ctx.beginPath(); ctx.roundRect(40, 40, 1000, canvas.height - 80, 42); ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.strokeStyle = colors.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(40.5, 40.5, 999, canvas.height - 81, 42); ctx.stroke();

    ctx.fillStyle = colors.accent;
    ctx.beginPath(); ctx.roundRect(120, 124, 42, 42, 13); ctx.fill();
    ctx.fillStyle = colors.paper; ctx.font = `700 39px Georgia, serif`; ctx.fillText("“", 128, 165);
    // ai coding: 将分享卡片左上角品牌文字改为 Read 2026/11/05: 13:48
    ctx.fillStyle = colors.ink; ctx.font = `600 24px ${fontFamily}`; ctx.fillText("Read", 181, 153);
    ctx.fillStyle = colors.muted; ctx.font = `400 20px ${fontFamily}`;
    ctx.textAlign = "right"; ctx.fillText("文章摘录", 960, 153); ctx.textAlign = "left";
    ctx.fillStyle = colors.accent; ctx.font = "140px Georgia, serif"; ctx.fillText("“", 112, 293);
    ctx.fillStyle = colors.ink; ctx.font = textFont;
    lines.forEach((line, index) => ctx.fillText(line, 120, 342 + index * lineHeight));

    ctx.strokeStyle = colors.line; ctx.beginPath(); ctx.moveTo(120, footerTop); ctx.lineTo(960, footerTop); ctx.stroke();
    ctx.fillStyle = colors.muted; ctx.font = `400 20px ${fontFamily}`;
    ctx.fillText("选自", 120, footerTop + 63);
    ctx.fillStyle = colors.ink; ctx.font = `600 26px ${fontFamily}`;
    clippedLines(ctx, title, 510, 3).forEach((line, index) => ctx.fillText(line, 120, footerTop + 108 + index * 40));
    ctx.fillStyle = colors.muted; ctx.font = `400 20px ${fontFamily}`;
    // ai coding: 分享卡片底部作者添加标签且无作者时保留来源 2026/11/05: 13:50
    const attribution = author.trim() ? `作者：${author.trim()}` : source || articleURL.hostname;
    ctx.fillText(clippedLines(ctx, attribution, 510, 1)[0] || articleURL.hostname, 120, footerTop + 253);
    // ai coding: 保留右下角原文二维码并移除扫码阅读原文说明 2026/11/05: 13:36
    drawQR(ctx, articleURL.href, 960, footerTop + 46);
    return canvas;
  }

  window.__readModeShareCard = Object.freeze({ render });
})();
