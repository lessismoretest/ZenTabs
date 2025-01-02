/**
 * 监听标签页更新
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    console.log('后台：标签页更新完成', tabId);
    try {
      // 向所有打开的 popup 发送消息
      chrome.runtime.sendMessage({
        type: 'TAB_UPDATED',
        tabId: tabId,
        tab: tab,
        keepFilter: true  // 添加标记，表示需要保持筛选状态
      }).catch(() => {
        // 忽略错误，popup 可能未打开
        console.log('后台：popup 未打开，无法发送消息');
      });
    } catch (error) {
      console.error('后台：发送标签页更新消息失败', error);
    }
  }
});

/**
 * 监听标签页创建
 */
chrome.tabs.onCreated.addListener(async (tab) => {
  console.log('后台：标签页创建事件触发', tab);
  try {
    // 向所有打开的 popup 发送消息
    chrome.runtime.sendMessage({
      type: 'TAB_CREATED',
      tab: tab,
      keepFilter: true  // 添加标记，表示需要保持筛选状态
    }).catch(() => {
      // 忽略错误，popup 可能未打开
      console.log('后台：popup 未打开，无法发送消息');
    });
  } catch (error) {
    console.error('后台：发送标签页创建消息失败', error);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}); 