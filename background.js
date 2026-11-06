// ai coding: 更新工具栏提示以显示默认 aa 与备用组合快捷键 2026/11/05: 09:40
const DEFAULT_TITLE = "进入 / 退出阅读模式（aa / Alt+Shift+R）";
const pendingTabs = new Set();

async function resetAction(tabId) {
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text: "" }),
    chrome.action.setTitle({ tabId, title: DEFAULT_TITLE }),
  ]);
}

// ai coding: 通过幂等入口进入阅读模式避免重复 aa 取消正在加载的界面 2026/11/05: 09:46
async function toggleReader(tab, { enterOnly = false } = {}) {
  if (!tab?.id || pendingTabs.has(tab.id)) return;
  pendingTabs.add(tab.id);

  try {
    if (tab.url && !/^(https?|file):/i.test(tab.url)) {
      throw new Error("请在普通文章网页中使用阅读模式；浏览器设置页与扩展页面不支持注入。");
    }

    if (enterOnly) {
      const [state] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          if (typeof window.__readModeController?.open === "function") {
            window.__readModeController.open();
            return true;
          }
          return Boolean(document.getElementById("__readmode_root__"));
        },
      });
      if (state?.result) {
        await resetAction(tab.id);
        return;
      }
    }
    // ai coding: 阅读模式注入时一并加载本地二维码及分享卡片绘制组件 2026/11/05: 13:23
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["lib/readability.js", "lib/qrcode.js", "share-card.js", "reader.js"],
    });
    await resetAction(tab.id);
  } catch (error) {
    const detail = error?.message || "页面暂时无法开启阅读模式。";
    await Promise.allSettled([
      chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#b43e35" }),
      chrome.action.setBadgeText({ tabId: tab.id, text: "!" }),
      chrome.action.setTitle({
        tabId: tab.id,
        title: `无法开启阅读模式：${detail} 本地网页需在扩展详情中开启“允许访问文件网址”。`,
      }),
    ]);
  } finally {
    pendingTabs.delete(tab.id);
  }
}

chrome.action.onClicked.addListener(toggleReader);

// ai coding: 接收同一扩展当前网页的 aa 请求并在服务线程中安全注入阅读器 2026/11/05: 09:40
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "readmode:open" || sender.id !== chrome.runtime.id || !sender.tab?.id) return;
  toggleReader(sender.tab, { enterOnly: true })
    .then(() => sendResponse({ received: true }))
    .catch(() => sendResponse({ received: false }));
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-reader") return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await toggleReader(tab);
  } catch {
    // The tab may close between the keyboard command and the tab lookup.
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") resetAction(tabId).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => pendingTabs.delete(tabId));
