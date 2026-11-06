// ai coding: 增加连续 aa 阅读快捷键并排除输入框与编辑器中的按键 2026/11/05: 09:40
(() => {
  "use strict";

  const demo = document.documentElement.dataset.readmodeDemo === "true";
  const extension = typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
  if ((!demo && !extension) || (demo && extension) || window.__readModeShortcutListener) return;
  window.__readModeShortcutListener = true;

  let firstA = null;
  let requesting = false;
  const reset = () => { firstA = null; };
  const editable = (element) => element instanceof Element && (
    element.matches('input, textarea, select, [role="textbox"], [role="searchbox"], [role="combobox"], [role="slider"]')
    || element.isContentEditable
  );

  // ai coding: 保守忽略无法检查内部焦点的闭影宿主与自定义控件 2026/11/05: 09:43
  function isEditing(event) {
    if (event.composedPath().some(editable)) return true;
    let focused = document.activeElement;
    while (focused) {
      if (editable(focused)) return true;
      focused = focused.shadowRoot?.activeElement;
    }
    const active = document.activeElement;
    return Boolean(active && active !== document.body && active !== document.documentElement
      && !active.matches("a[href], button, summary") && active.matches(":focus-within"));
  }

  async function requestReader() {
    if (requesting) return;
    requesting = true;
    try {
      if (demo) await window.__readModeController?.open();
      else await chrome.runtime.sendMessage({ type: "readmode:open" });
    } catch {
      // ai coding: 扩展重载或页面关闭时忽略已失效的快捷键请求 2026/11/05: 09:40
    } finally {
      requesting = false;
    }
  }

  // ai coding: 仅处理真实按键并排除输入法边界事件避免网页模拟触发 2026/11/05: 09:43
  document.addEventListener("keydown", (event) => {
    if (!event.isTrusted || event.isComposing || event.keyCode === 229 || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
      || isEditing(event) || document.getElementById("__readmode_root__")) {
      reset();
      return;
    }
    if (event.key.toLowerCase() !== "a") {
      reset();
      return;
    }
    const now = performance.now();
    if (firstA !== null && now - firstA <= 600) {
      reset();
      event.preventDefault();
      requestReader();
    } else {
      firstA = now;
    }
  }, true);
  window.addEventListener("blur", reset);
  document.addEventListener("visibilitychange", reset);
  // ai coding: 输入法开始与结束时清空未完成的 aa 按键序列 2026/11/05: 09:43
  document.addEventListener("compositionstart", reset, true);
  document.addEventListener("compositionend", reset, true);
})();
