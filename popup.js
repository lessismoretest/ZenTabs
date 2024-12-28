/**
 * @typedef {Object} Tab
 * @property {string} title - 标签页标题
 * @property {string} url - 标签页URL
 * @property {string} favIconUrl - 标签页图标URL
 */

/**
 * @typedef {Object} Settings
 * @property {string} themeMode - 主题模式 ('auto' | 'light' | 'dark')
 */

/**
 * @type {Settings}
 */
let settings = getDefaultSettings();

/**
 * 初始化应用
 */
async function initialize() {
  console.log('popup：开始初始化');
  try {
    // 加载设置
    const data = await chrome.storage.local.get('settings');
    settings = { ...getDefaultSettings(), ...data.settings };
    
    // 应用主题
    applyThemeMode(settings.themeMode);
    
    // 渲染设置
    renderSettings(settings);
    
    // 获取并显示当前标签页
    const tabs = await getCurrentTabs();
    console.log('popup：初始化时获取到标签页数量:', tabs.length);
    
    // 根据默认视图设置渲染
    if (settings.defaultView === 'domain') {
      const groups = groupTabs(tabs);
      renderGroups(groups);
    } else if (settings.defaultView === 'ai') {
      // 显示加载状态
      const button = document.getElementById('aiGroupTabs');
      if (button) {
        button.classList.add('loading');
      }
      // 调用AI分组
      await aiGroupTabs(tabs);
      // 移除加载状态
      if (button) {
        button.classList.remove('loading');
      }
    } else {
      renderDefaultView(tabs);
    }
    
    // 初始化事件监听器
    initializeEventListeners();
    
    // 设置自动刷新
    setupAutoRefresh();
  } catch (error) {
    console.error('popup：初始化失败:', error);
  }
}

/**
 * 添加一个变量来跟踪当前选中的域名
 */
let currentSelectedDomain = null;

/**
 * 设置自动刷新
 */
function setupAutoRefresh() {
  console.log('popup：设置自动刷新');
  
  // 每秒检查一次标签页列表
  setInterval(async () => {
    try {
      const tabs = await getCurrentTabs();
      const tabsContainer = document.getElementById('tabGroups');
      
      if (!tabsContainer) {
        console.error('popup：未找到标签页容器');
        return;
      }
      
      const isGroupView = tabsContainer.querySelector('.tab-group') !== null;
      if (isGroupView) {
        console.log('popup：使用分组视图刷新');
        const groups = groupTabs(tabs);
        renderGroups(groups);
        // 如果有选中的域名，重新应用筛选
        if (currentSelectedDomain) {
          document.querySelectorAll('.tab-group').forEach(group => {
            if (group.id === `group-${currentSelectedDomain}`) {
              group.style.display = '';
            } else {
              group.style.display = 'none';
            }
          });
        }
      } else {
        console.log('popup：使用默认视图刷新');
        const sortMethod = document.getElementById('sortSelect')?.value || 'time-desc';
        const sortedTabs = sortTabs(tabs.map(tab => ({
          tab,
          newTitle: tab.title || 'New Tab',
          pinned: pinnedTabs.has(tab.id)
        })), sortMethod);
        
        // 创建临时分组用于筛选
        const tempGroups = {};
        sortedTabs.forEach(({tab}) => {
          try {
            const domain = tab.url ? new URL(tab.url).hostname : 'other';
            if (!tempGroups[domain]) {
              tempGroups[domain] = [];
            }
            tempGroups[domain].push({tab, newTitle: tab.title});
          } catch (error) {
            if (!tempGroups['other']) {
              tempGroups['other'] = [];
            }
            tempGroups['other'].push({tab, newTitle: tab.title});
          }
        });
        
        renderDefaultView(tabs);
        
        // 如果有选中的域名，重新应用筛选
        if (currentSelectedDomain && tempGroups[currentSelectedDomain]) {
          const selectedTabs = tempGroups[currentSelectedDomain];
          document.querySelectorAll('.tab-item').forEach(item => {
            try {
              const tabId = parseInt(item.getAttribute('data-tab-id'));
              const tab = selectedTabs.find(i => i.tab.id === tabId);
              if (tab) {
                item.style.display = '';
              } else {
                item.style.display = 'none';
              }
            } catch (error) {
              console.error('处理标签页筛选失败:', error);
            }
          });
          
          // 重新高亮选中的图标
          document.querySelectorAll('.favicon-item').forEach(item => {
            const domain = item.getAttribute('data-domain');
            if (domain === currentSelectedDomain) {
              item.classList.add('active');
            } else {
              item.classList.remove('active');
            }
          });
        }
      }
    } catch (error) {
      console.error('popup：自动刷新失败:', error);
    }
  }, 1000); // 每秒刷新一次
}

/**
 * 加载标签页列表
 */
async function loadTabs() {
  const tabs = await chrome.tabs.query({});
  const tabList = document.getElementById('tabList');
  if (!tabList) return;
  
  tabList.innerHTML = '';
  tabs.forEach(tab => {
    const tabElement = createTabElement(tab);
    tabList.appendChild(tabElement);
  });
}

/**
 * 创建标签页元素
 * @param {chrome.tabs.Tab} tab
 */
function createTabElement(tab) {
  const li = document.createElement('li');
  li.className = 'tab-item';
  li.dataset.tabId = tab.id?.toString();
  
  li.innerHTML = `
    <img class="tab-favicon" src="${tab.favIconUrl || 'default-favicon.png'}" alt="">
    <span class="tab-title">${tab.title}</span>
    <button class="close-tab" title="关闭标签页">×</button>
  `;
  
  // 点击标签页
  li.addEventListener('click', (e) => {
    if (e.target.classList.contains('close-tab')) {
      // 关闭标签页
      chrome.tabs.remove(tab.id);
      li.remove();
    } else {
      // 切换到标签页
      chrome.tabs.update(tab.id, { active: true });
      chrome.windows.update(tab.windowId, { focused: true });
    }
  });
  
  return li;
}

/**
 * 初始化事件监听器
 */
function initializeEventListeners() {
  // 视图切换按钮
  document.getElementById('defaultView').addEventListener('click', () => switchView('default'));
  document.getElementById('groupTabs').addEventListener('click', () => switchView('domain'));
  document.getElementById('aiGroupTabs').addEventListener('click', () => switchView('ai'));
  
  // 新建标签页按钮
  document.getElementById('newTabButton').addEventListener('click', () => {
    chrome.tabs.create({});
  });
  
  // 分享按钮
  document.getElementById('shareButton').addEventListener('click', toggleShareMode);
  
  // 设置按钮
  document.getElementById('settingsButton').addEventListener('click', toggleSettings);
  
  // 搜索输入框
  document.getElementById('searchInput').addEventListener('input', handleSearch);
  
  // 排序选择
  document.getElementById('sortSelect').addEventListener('change', handleSort);
  
  // 设置面板按钮
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
  document.getElementById('cancelSettings').addEventListener('click', toggleSettings);
  document.querySelector('.close-settings').addEventListener('click', toggleSettings);
  
  // 分享面板按钮
  document.getElementById('copySelected').addEventListener('click', copySelectedTabs);
  document.getElementById('cancelShare').addEventListener('click', toggleShareMode);
}

// 当文档加载完成时初始化
document.addEventListener('DOMContentLoaded', async () => {
  console.log('popup：DOM加载完成');
  try {
    // 加载设置
    const data = await chrome.storage.local.get('settings');
    settings = { ...getDefaultSettings(), ...data.settings };
    console.log('popup：加载设置:', settings);
    
    // 应用主题
    applyThemeMode(settings.themeMode);
    
    // 渲染设置
    renderSettings(settings);
    
    // 获取并显示当前标签页
    const tabs = await getCurrentTabs();
    console.log('popup：初始化时获取到标签页数量:', tabs.length);
    
    // 根据默认视图设置渲染
    if (settings.defaultView === 'domain') {
      const groups = groupTabs(tabs);
      renderGroups(groups);
      // 更新按钮状态
      document.getElementById('groupTabs').classList.add('active');
    } else if (settings.defaultView === 'ai') {
      // 显示加载状态
      const button = document.getElementById('aiGroupTabs');
      if (button) {
        button.classList.add('loading');
      }
      await aiGroupTabs(tabs);
      if (button) {
        button.classList.remove('loading');
      }
      // 更新按钮状态
      button.classList.add('active');
    } else {
      renderDefaultView(tabs);
      // 更新按钮状态
      document.getElementById('defaultView').classList.add('active');
    }
    
    // 初始化事件监听器
    initializeEventListeners();
    
    // 设置自动刷新
    setupAutoRefresh();
  } catch (error) {
    console.error('popup：初始化失败:', error);
  }
});

/**
 * 获取当前窗口的所有标签页
 * @returns {Promise<Tab[]>}
 */
async function getCurrentTabs() {
  try {
    console.log('开始获取当前窗口的标签页');
    const tabs = await chrome.tabs.query({ currentWindow: true });
    console.log('获取到标签页数量:', tabs.length);
    console.log('标签页列表:', tabs);
    return tabs;
  } catch (error) {
    console.error('获取标签页失败:', error);
    return [];
  }
}

/**
 * 根据URL对标签页进行分组
 * @param {Tab[]} tabs - 标签页数组
 * @returns {Object.<string, Array<{tab: Tab, newTitle: string}>>}
 */
function groupTabs(tabs) {
  const groups = {};
  const sortMethod = document.getElementById('sortSelect').value;
  
  tabs.forEach(tab => {
    try {
      // 检查 URL 是否有效
      const domain = tab.url ? new URL(tab.url).hostname : 'other';
      if (!groups[domain]) {
        groups[domain] = [];
      }
      groups[domain].push({
        tab: tab,
        newTitle: tab.title,
        pinned: pinnedTabs.has(tab.id)
      });
    } catch (error) {
      // 如果 URL 无效，将标签页归类到 "other" 组
      if (!groups['other']) {
        groups['other'] = [];
      }
      groups['other'].push({
        tab: tab,
        newTitle: tab.title,
        pinned: pinnedTabs.has(tab.id)
      });
    }
  });
  
  // 对每个组内的标签进行排序
  for (const domain in groups) {
    let sortedTabs = groups[domain];
    // 首先按置顶状态排序
    sortedTabs.sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }
      return 0;
    });
    // 然后按选择的方式排序非置顶标签
    const unpinnedTabs = sortedTabs.filter(item => !item.pinned);
    const sortedUnpinnedTabs = sortTabs(unpinnedTabs, sortMethod);
    const pinnedTabs = sortedTabs.filter(item => item.pinned);
    groups[domain] = [...pinnedTabs, ...sortedUnpinnedTabs];
  }
  
  return groups;
}

/**
 * 创建字母索引
 * @param {string[]} groupNames - 组名称数组
 */
function createLetterIndex(groupNames) {
  const indexContainer = document.getElementById('letterIndex');
  indexContainer.innerHTML = '';
  
  // 获取所有分组名称的首字母并排序
  const firstLetters = [...new Set(groupNames.map(name => {
    const firstChar = name.charAt(0).toUpperCase();
    return /[A-Z]/.test(firstChar) ? firstChar : '#';
  }))].sort();

  // 创建字母索引按钮
  firstLetters.forEach(letter => {
    const indexItem = document.createElement('div');
    indexItem.className = 'index-item';
    indexItem.textContent = letter;
    indexItem.addEventListener('click', () => {
      // 查找以该字母开头的第一个分组
      const targetGroup = groupNames.find(name => {
        const firstChar = name.charAt(0).toUpperCase();
        return firstChar === letter || (letter === '#' && !/[A-Z]/.test(firstChar));
      });
      
      if (targetGroup) {
        const element = document.getElementById(`group-${targetGroup}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth' });
          // 高亮显示当前选中的索引
          document.querySelectorAll('.index-item').forEach(item => {
            item.classList.remove('active');
          });
          indexItem.classList.add('active');
        }
      }
    });
    indexContainer.appendChild(indexItem);
  });
}

/**
 * 创建网站图标索引
 * @param {Object.<string, Array<{tab: Tab, newTitle: string}>>} groups - 分组后的标签页
 */
function createFaviconIndex(groups) {
  const indexContainer = document.getElementById('faviconIndex');
  indexContainer.innerHTML = '';
  
  // 获取每个分组的第一个标签页作为代表
  Object.entries(groups).forEach(([groupName, items]) => {
    const firstTab = items[0].tab;
    const indexItem = document.createElement('div');
    indexItem.className = 'favicon-item';
    indexItem.setAttribute('data-domain', groupName);
    
    // 如果是当前选中的域名，添加active类
    if (groupName === currentSelectedDomain) {
      indexItem.classList.add('active');
    }
    
    // 创建图标占位符
    if (firstTab.favIconUrl) {
      const img = document.createElement('img');
      img.src = firstTab.favIconUrl;
      img.alt = '';
      img.onerror = () => {
        img.style.display = 'none';
        indexItem.innerHTML = '<div class="favicon-placeholder"></div>';
      };
      indexItem.appendChild(img);
    } else {
      indexItem.innerHTML = '<div class="favicon-placeholder"></div>';
    }
    
    // 添加点击事件
    indexItem.addEventListener('click', () => {
      // 更新当前选中的域名
      currentSelectedDomain = groupName;
      
      // 高亮显示当前选中的图标
      document.querySelectorAll('.favicon-item').forEach(item => {
        item.classList.remove('active');
      });
      indexItem.classList.add('active');

      // 获取当前是否为分组视图
      const tabsContainer = document.getElementById('tabGroups');
      const isGroupView = tabsContainer.querySelector('.tab-group') !== null;

      if (isGroupView) {
        // 分组视图下的筛选逻辑
        document.querySelectorAll('.tab-group').forEach(group => {
          if (group.id === `group-${groupName}`) {
            group.style.display = '';
            group.scrollIntoView({ behavior: 'smooth' });
          } else {
            group.style.display = 'none';
          }
        });
      } else {
        // 默认视图下的筛选逻辑
        document.querySelectorAll('.tab-item').forEach(item => {
          try {
            const tabId = parseInt(item.getAttribute('data-tab-id'));
            const tab = items.find(i => i.tab.id === tabId);
            if (tab) {
              item.style.display = '';
            } else {
              item.style.display = 'none';
            }
          } catch (error) {
            console.error('处理标签页筛选失败:', error);
          }
        });
      }
    });
    
    indexContainer.appendChild(indexItem);
  });
  
  // 添加"显示全部"按钮
  const showAllItem = document.createElement('div');
  showAllItem.className = 'favicon-item show-all';
  showAllItem.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M4 6h16M4 12h16M4 18h16"/>
    </svg>
  `;
  showAllItem.title = '显示全部';
  
  showAllItem.addEventListener('click', () => {
    // 清除当前选中的域名
    currentSelectedDomain = null;
    
    // 移除所有���标的高亮
    document.querySelectorAll('.favicon-item').forEach(item => {
      item.classList.remove('active');
    });

    // 获取当前是否为分组视图
    const tabsContainer = document.getElementById('tabGroups');
    const isGroupView = tabsContainer.querySelector('.tab-group') !== null;

    if (isGroupView) {
      // 显示所有标签页组
      document.querySelectorAll('.tab-group').forEach(group => {
        group.style.display = '';
      });
    } else {
      // 显示所有标签页
      document.querySelectorAll('.tab-item').forEach(item => {
        item.style.display = '';
      });
    }
  });
  
  indexContainer.insertBefore(showAllItem, indexContainer.firstChild);
}

/**
 * 渲染标签页分组
 * @param {Object.<string, Array<{tab: Tab, newTitle: string}>>} groups - 分组后的标签页
 */
function renderGroups(groups) {
  const container = document.getElementById('tabGroups');
  container.innerHTML = '';
  
  // 如果处于分享模式，添加分享模式的类
  if (isShareMode) {
    container.classList.add('share-mode');
  } else {
    container.classList.remove('share-mode');
  }
  
  // 获取所有分组名称排序
  const groupNames = Object.keys(groups).sort((a, b) => {
    const aChar = a.charAt(0).toUpperCase();
    const bChar = b.charAt(0).toUpperCase();
    const aIsLetter = /[A-Z]/.test(aChar);
    const bIsLetter = /[A-Z]/.test(bChar);
    
    if (aIsLetter && !bIsLetter) return -1;
    if (!aIsLetter && bIsLetter) return 1;
    return a.localeCompare(b);
  });

  // 只在启用时创建字母索引
  if (settings.letterIndexEnabled) {
    createLetterIndex(groupNames);
  } else {
    const letterIndex = document.getElementById('letterIndex');
    if (letterIndex) {
      letterIndex.innerHTML = '';
    }
  }

  createFaviconIndex(groups);
  
  // 添加顶部栏
  const header = document.createElement('div');
  header.className = 'tabs-header';
  header.innerHTML = `
    <div class="tabs-divider"></div>
    <button class="clear-button">clear</button>
  `;

  // 添加清除按钮事件
  const clearButton = header.querySelector('.clear-button');
  clearButton.addEventListener('click', async () => {
    try {
      const allTabs = await getCurrentTabs();
      const tabIds = allTabs.map(tab => tab.id);
      await chrome.tabs.remove(tabIds);
      // 保留一个新标签页
      await chrome.tabs.create({});
      // 重新加载列表
      const remainingTabs = await getCurrentTabs();
      renderGroups(groupTabs(remainingTabs));
    } catch (error) {
      console.error('关闭所有标签页失败:', error);
    }
  });

  container.appendChild(header);
  
  // 渲染分组
  groupNames.forEach(groupName => {
    const items = groups[groupName];
    const groupElement = document.createElement('div');
    groupElement.className = 'tab-group';
    groupElement.id = `group-${groupName}`;
    
    const header = document.createElement('div');
    header.className = 'group-header';
    header.innerHTML = `
      <span>${groupName}</span>
      <div class="group-close-button" title="关闭分组">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </div>
    `;
    
    // 添加分组关闭按钮事件
    const closeButton = header.querySelector('.group-close-button');
    closeButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeGroup(groupName, items);
    });

    const divider = document.createElement('div');
    divider.className = 'group-divider';
    
    const tabList = document.createElement('div');
    tabList.className = 'tab-list';
    
    items.forEach(({tab, newTitle, pinned}) => {
      const tabItem = document.createElement('div');
      tabItem.className = 'tab-item';
      tabItem.setAttribute('data-tab-id', tab.id);
      if (isShareMode && selectedTabs.has(tab.id)) {
        tabItem.classList.add('selected');
      }
      if (pinned) {
        tabItem.classList.add('pinned');
      }
      if (tab.active) {
        tabItem.classList.add('active');
      }
      
      // 处理 favicon
      let faviconHtml = '';
      if (tab.favIconUrl) {
        faviconHtml = `<img class="tab-favicon" src="${tab.favIconUrl}" alt="" onerror="this.style.display='none'">`;
      } else {
        faviconHtml = `<div class="tab-favicon-placeholder"></div>`;
      }
      
      // 添加置顶按钮和关闭按钮
      const pinButtonHtml = `
        <div class="pin-button" title="置顶标签页">
          <svg viewBox="0 0 24 24">
            <path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z" />
          </svg>
        </div>
      `;

      const closeButtonHtml = `
        <div class="close-button" title="关闭标签页">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </div>
      `;
      
      tabItem.innerHTML = `
        ${faviconHtml}
        <span class="tab-title" title="${tab.title}">${newTitle}</span>
        <div class="tab-actions">
          ${pinButtonHtml}
          ${closeButtonHtml}
        </div>
      `;
      
      // 添加点击事件处理
      tabItem.addEventListener('click', (e) => {
        // 如果点击的是关闭按钮
        if (e.target.closest('.close-button')) {
          e.preventDefault();
          e.stopPropagation();
          closeTab(tab.id);
          return;
        }

        // 如果点击的是置顶按钮
        if (e.target.closest('.pin-button')) {
          e.preventDefault();
          e.stopPropagation();
          togglePinned(tab, tabItem);
          return;
        }
        
        if (isShareMode) {
          e.preventDefault();
          e.stopPropagation();
          handleTabClick(tabItem, tab);
        } else {
          chrome.tabs.update(tab.id, { active: true });
        }
      });
      
      tabList.appendChild(tabItem);
    });
    
    groupElement.appendChild(header);
    groupElement.appendChild(divider);
    groupElement.appendChild(tabList);
    container.appendChild(groupElement);
  });
}

/**
 * 从响应文本中提取JSON字符串
 * @param {string} text - 响���文本
 * @returns {string} JSON字符串
 */
function extractJsonFromResponse(text) {
  // 尝试直接解析
  try {
    JSON.parse(text);
    return text;
  } catch (e) {
    // 如果直接解析失败，尝试提取JSON部分
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return jsonMatch[0];
    }
    throw new Error('无法从响应中提取效的JSON');
  }
}

/**
 * 调用 Gemini API 进行智能分组和标题重命名
 * @param {Tab[]} tabs - 标签页数组
 * @returns {Promise<Object.<string, Array<{tab: Tab, newTitle: string}>>>}
 */
async function aiGroupTabs(tabs) {
  const API_KEY = 'AIzaSyCVF1DEc9hQbam42-eMObONqISF-fm3kH4';
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${API_KEY}`;

  // 准备标签页数据
  const tabsData = tabs.map((tab, index) => ({
    index,
    title: tab.title,
    url: tab.url,
    domain: new URL(tab.url).hostname
  }));

  const prompt = `作为标签页管理助手，请完成两个任务：
1. 将标签页分组
2. 每个标签页生成短清晰的新标题

要求：
1. 分组要求：
   - 根据页面内容和主题进行分组
   - 组名称要简短精确，如"前端开发"而不是"编程"
   - 相似主题的标签页应合并到同一组

2. 标题重命名要求：
   - 保持简洁但信息量充足
   - 去除冗余词语和网站名称
   - 突出核心内容
   - 长度控制在15字以内

标签页数据：
${JSON.stringify(tabsData, null, 2)}

请返回如下格式的JSON：
{
  "组名称": [
    {
      "index": 标签页索引,
      "newTitle": "新标题"
    }
  ]
}`;

  try {
    console.log('发送AI请求...');
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
        }
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('AI响应:', data);

    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      throw new Error('Invalid API response structure');
    }

    const aiResponse = data.candidates[0].content.parts[0].text;
    console.log('AI返回文本:', aiResponse);

    // 提取并解析JSON
    const jsonStr = extractJsonFromResponse(aiResponse);
    const groupingResult = JSON.parse(jsonStr);
    console.log('解析后的分组结果:', groupingResult);

    // 将索引映射到实际的标签页对象，并更新标题
    const groupedTabs = {};
    for (const [groupName, items] of Object.entries(groupingResult)) {
      const groupTabs = items.map(item => {
        const tab = tabs[item.index];
        if (!tab) {
          console.error(`找不到索引 ${item.index} 对应的标签页`);
          return null;
        }
        return {
          tab,
          newTitle: item.newTitle
        };
      }).filter(item => item !== null);

      if (groupTabs.length > 0) {
        groupedTabs[groupName] = groupTabs;
      }
    }

    return groupedTabs;
  } catch (error) {
    console.error('AI分组失败:', error);
    alert(`AI分组失败: ${error.message}`);
    // 如果失败返回原的域名分组不重命名标题
    const originalGroups = groupTabs(tabs);
    return Object.fromEntries(
      Object.entries(originalGroups).map(([groupName, groupTabs]) => [
        groupName,
        groupTabs.map(tab => ({ tab, newTitle: tab.title }))
      ])
    );
  }
}

/**
 * 初始化所有事件监听器
 */
function initializeEventListeners() {
  // 视图切换按钮
  document.getElementById('defaultView').addEventListener('click', () => switchView('default'));
  document.getElementById('groupTabs').addEventListener('click', () => switchView('domain'));
  document.getElementById('aiGroupTabs').addEventListener('click', () => switchView('ai'));
  
  // 新建标签页按钮
  document.getElementById('newTabButton').addEventListener('click', () => {
    chrome.tabs.create({});
  });
  
  // 分享按钮
  document.getElementById('shareButton').addEventListener('click', toggleShareMode);
  
  // 设置按钮
  document.getElementById('settingsButton').addEventListener('click', toggleSettings);
  
  // 搜索输入框
  document.getElementById('searchInput').addEventListener('input', handleSearch);
  
  // 排序选择
  document.getElementById('sortSelect').addEventListener('change', handleSort);
  
  // 设置面板按钮
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
  document.getElementById('cancelSettings').addEventListener('click', toggleSettings);
  document.querySelector('.close-settings').addEventListener('click', toggleSettings);
  
  // 分享面板按钮
  document.getElementById('copySelected').addEventListener('click', copySelectedTabs);
  document.getElementById('cancelShare').addEventListener('click', toggleShareMode);
}

// 添加分享相关的状态和函数
let isShareMode = false;
let selectedTabs = new Set();

/**
 * 切换分享模式
 * @param {boolean} enabled - 是否启用分享模式
 */
function toggleShareMode(enabled) {
  isShareMode = enabled;
  const container = document.getElementById('tabGroups');
  const overlay = document.getElementById('shareOverlay');
  const shareButton = document.getElementById('shareButton');
  
  if (enabled) {
    container.classList.add('share-mode');
    overlay.style.display = 'block';
    shareButton.style.display = 'none';
    selectedTabs.clear();
    updateSelectedCount();
  } else {
    container.classList.remove('share-mode');
    overlay.style.display = 'none';
    shareButton.style.display = 'flex';
    selectedTabs.clear();
  }
  
  // 重新渲染以更新UI状态
  getCurrentTabs().then(tabs => {
    const groups = groupTabs(tabs);
    renderGroups(groups);
  });
}

/**
 * 更新选中计数
 */
function updateSelectedCount() {
  const countElement = document.getElementById('selectedCount');
  countElement.textContent = `已选择 ${selectedTabs.size} 项`;
}

/**
 * 处理标签页点击
 * @param {HTMLElement} tabItem - 标签页元素
 * @param {Tab} tab - 标签页数据
 */
function handleTabClick(tabItem, tab) {
  if (isShareMode) {
    if (selectedTabs.has(tab.id)) {
      selectedTabs.delete(tab.id);
      tabItem.classList.remove('selected');
    } else {
      selectedTabs.add(tab.id);
      tabItem.classList.add('selected');
    }
    updateSelectedCount();
    return true;
  }
  return false;
}

// 添加置顶相关的状态
let pinnedTabs = new Set();

/**
 * 切换标签页置顶状态
 * @param {Tab} tab - 标签页
 * @param {HTMLElement} tabItem - 标签页元素
 */
function togglePinned(tab, tabItem) {
  if (pinnedTabs.has(tab.id)) {
    pinnedTabs.delete(tab.id);
    tabItem.classList.remove('pinned');
  } else {
    pinnedTabs.add(tab.id);
    tabItem.classList.add('pinned');
  }
  
  // 保存置顶状态到 storage
  chrome.storage.local.set({ pinnedTabs: Array.from(pinnedTabs) });
  
  // 重新渲染以更新顺序
  getCurrentTabs().then(tabs => {
    const groups = groupTabs(tabs);
    renderGroups(groups);
  });
}

/**
 * 应用扩展位置设置
 */
async function applyExtensionPosition() {
  try {
    // 通过 chrome.sidePanel API 设置面板位置
    await chrome.sidePanel.setOptions({
      enabled: true,
      path: 'popup.html#sidepanel'
    });
    
    // 如果当前不是侧边栏模式，则关闭当前窗重新打开侧边栏
    if (window.location.hash !== '#sidepanel') {
      await chrome.sidePanel.open();
      window.close();
    }
  } catch (error) {
    console.error('设置侧边栏位置失败:', error);
  }
}

/**
 * 修改保存设置��数
 */
async function saveSettings() {
  try {
    settings.themeMode = document.getElementById('themeMode').value;
    settings.defaultView = document.getElementById('defaultView').value;
    
    await chrome.storage.local.set({ settings });
    console.log('设置已保存:', settings);
    
    // 应用设置
    applyThemeMode(settings.themeMode);
    
    // 根据默认视图设置重新渲染
    const tabs = await getCurrentTabs();
    if (settings.defaultView === 'domain') {
      const groups = groupTabs(tabs);
      renderGroups(groups);
      // 更新按钮状态
      document.getElementById('groupTabs').classList.add('active');
      document.getElementById('defaultView').classList.remove('active');
      document.getElementById('aiGroupTabs').classList.remove('active');
    } else if (settings.defaultView === 'ai') {
      await aiGroupTabs(tabs);
      // 更新按钮状态
      document.getElementById('aiGroupTabs').classList.add('active');
      document.getElementById('defaultView').classList.remove('active');
      document.getElementById('groupTabs').classList.remove('active');
    } else {
      renderDefaultView(tabs);
      // 更新按钮状态
      document.getElementById('defaultView').classList.add('active');
      document.getElementById('groupTabs').classList.remove('active');
      document.getElementById('aiGroupTabs').classList.remove('active');
    }
    
    // 关闭设置面板
    document.getElementById('settingsOverlay').style.display = 'none';
  } catch (error) {
    console.error('保存设置失败:', error);
  }
}

/**
 * 修改加载设置函数
 */
async function loadSettings() {
  const result = await chrome.storage.local.get('settings');
  if (result.settings) {
    settings = result.settings;
    // 更新选择框的值
    document.getElementById('letterIndexEnabled').value = settings.letterIndexEnabled.toString();
    document.getElementById('letterIndexPosition').value = settings.letterIndexPosition;
    document.getElementById('faviconIndexPosition').value = settings.faviconIndexPosition;
    document.getElementById('extensionPosition').value = settings.extensionPosition;
    
    // 根据字母索引开关状态显示/隐藏位置设置
    document.getElementById('letterIndexPositionSetting').style.display = 
      settings.letterIndexEnabled ? 'block' : 'none';
  }
  applySettings();
  applyExtensionPosition();
}

/**
 * 应用设置
 */
function applySettings() {
  const mainContainer = document.querySelector('.main-container');
  const letterIndex = document.getElementById('letterIndex').closest('.side-panel');
  const faviconIndex = document.getElementById('faviconIndex').closest('.side-panel');
  
  // 移除现有的索引
  letterIndex.remove();
  faviconIndex.remove();
  
  // 根据设置重新添加引
  if (settings.letterIndexPosition === 'left') {
    mainContainer.insertBefore(letterIndex, mainContainer.firstChild);
  } else {
    mainContainer.appendChild(letterIndex);
  }
  
  if (settings.faviconIndexPosition === 'left') {
    mainContainer.insertBefore(faviconIndex, mainContainer.firstChild);
  } else {
    mainContainer.appendChild(faviconIndex);
  }
}

/**
 * 搜索标签页
 * @param {string} query - 搜索关键词
 */
function searchTabs(query) {
  const tabItems = document.querySelectorAll('.tab-item');
  const groups = document.querySelectorAll('.tab-group');
  const searchTerm = query.toLowerCase();

  groups.forEach(group => {
    let hasVisibleTabs = false;

    // 搜索每个标签页
    const tabs = group.querySelectorAll('.tab-item');
    tabs.forEach(tab => {
      const title = tab.querySelector('.tab-title').textContent.toLowerCase();
      const titleElement = tab.querySelector('.tab-title');
      
      if (searchTerm === '') {
        // 如果搜索为空，显示所有标签页并移除高亮
        tab.classList.remove('hidden');
        titleElement.innerHTML = titleElement.textContent;
        hasVisibleTabs = true;
      } else if (title.includes(searchTerm)) {
        // 如果匹配，显示并高亮
        tab.classList.remove('hidden');
        titleElement.innerHTML = highlightText(titleElement.textContent, searchTerm);
        hasVisibleTabs = true;
      } else {
        // 如果匹配，隐藏
        tab.classList.add('hidden');
      }
    });

    // 如果组内没有可见的标签页，隐藏整个组
    group.style.display = hasVisibleTabs ? '' : 'none';
  });
}

/**
 * 高亮文本的匹配部分
 * @param {string} text - 原始文本
 * @param {string} term - 需要高亮的关键词
 * @returns {string} 带有高亮标记的HTML
 */
function highlightText(text, term) {
  const regex = new RegExp(`(${term})`, 'gi');
  return text.replace(regex, '<span class="highlight">$1</span>');
}

// 添加快键支持
document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd + F 聚焦搜索框
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.focus();
    }
  }
  
  // ESC 空索框
  if (e.key === 'Escape' && document.activeElement === searchInput) {
    searchInput.value = '';
    searchTabs('');
    searchInput.blur();
  }
});

/**
 * 创建新标签页
 */
async function createNewTab() {
  try {
    console.log('开始创建新标签页');
    const tab = await chrome.tabs.create({ active: true });
    console.log('新建标签页成功:', tab);
    
    // 等待标签页完全加载
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 重新加载标签页列表
    console.log('开始重新加载标签页列表');
    const tabs = await getCurrentTabs();
    console.log('获取到当前标签页:', tabs);
    
    const container = document.getElementById('tabGroups');
    if (!container) {
      console.error('未找到标签页容器');
      return;
    }
    
    // 直接使用默认视图
    console.log('使用默认视图渲染');
    renderDefaultView(tabs);
    
    // 验证新标签页是否显示
    const newTabElement = container.querySelector(`[data-tab-id="${tab.id}"]`);
    if (newTabElement) {
      console.log('新标签页元素已创建');
    } else {
      console.error('未找到新标签页元素');
    }
  } catch (error) {
    console.error('新建标签页失败:', error);
  }
}

/**
 * 关闭标签页
 * @param {number} tabId - 标签页ID
 */
async function closeTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
    // 重新加载标签页列表
    const tabs = await getCurrentTabs();
    
    // 获取当前视图模式
    const tabsContainer = document.getElementById('tabGroups');
    const isGroupView = tabsContainer.querySelector('.tab-group') !== null;
    
    // 根据当前视图模式重新渲染
    if (isGroupView) {
      console.log('使用分组视图渲染');
      const groups = groupTabs(tabs);
      renderGroups(groups);
    } else {
      console.log('使用默认视图渲染');
      renderDefaultView(tabs);
    }
  } catch (error) {
    console.error('关闭标签页失败:', error);
  }
}

/**
 * 关闭分组中的所有标签页
 * @param {string} groupName - 分组名称
 * @param {Array<{tab: Tab}>} items - 分组中的标签页
 */
async function closeGroup(groupName, items) {
  try {
    // 获取所有标签页ID
    const tabIds = items.map(item => item.tab.id);
    
    // 直接关闭标签页，不示确认提示
    await chrome.tabs.remove(tabIds);
    
    // 重新加载标签页列表
    const tabs = await getCurrentTabs();
    const groups = groupTabs(tabs);
    renderGroups(groups);
  } catch (error) {
    console.error('关闭分组失败:', error);
  }
}

// 添加访问率记录
let tabAccessCount = new Map();

/**
 * 记录标签页访问
 * @param {number} tabId - 标签页ID
 */
function recordTabAccess(tabId) {
  const count = tabAccessCount.get(tabId) || 0;
  tabAccessCount.set(tabId, count + 1);
  // 保存到 storage
  chrome.storage.local.set({ tabAccessCount: Array.from(tabAccessCount.entries()) });
}

/**
 * 加载访问记录
 */
async function loadTabAccessCount() {
  const result = await chrome.storage.local.get('tabAccessCount');
  if (result.tabAccessCount) {
    tabAccessCount = new Map(result.tabAccessCount);
  }
}

/**
 * 根据选的方式对标签页进行排序
 * @param {Array<{tab: Tab, newTitle: string}>} tabs - 标签页数组
 * @param {string} sortMethod - 排序方式
 * @returns {Array<{tab: Tab, newTitle: string}>}
 */
function sortTabs(tabs, sortMethod) {
  switch (sortMethod) {
    case 'time-asc':
      return [...tabs].sort((a, b) => a.tab.id - b.tab.id);
    case 'time-desc':
      return [...tabs].sort((a, b) => b.tab.id - a.tab.id);
    case 'freq-asc':
      return [...tabs].sort((a, b) => 
        (tabAccessCount.get(a.tab.id) || 0) - (tabAccessCount.get(b.tab.id) || 0)
      );
    case 'freq-desc':
      return [...tabs].sort((a, b) => 
        (tabAccessCount.get(b.tab.id) || 0) - (tabAccessCount.get(a.tab.id) || 0)
      );
    default:
      return tabs;
  }
}

/**
 * 渲染默认视图（不分组）
 * @param {Tab[]} tabs - 标签页数组
 */
function renderDefaultView(tabs) {
  console.log('开始渲染默认视图，标签页数量:', tabs.length);
  
  const container = document.getElementById('tabGroups');
  if (!container) {
    console.error('未找到标签页容器');
    return;
  }
  
  // 清空容器
  container.innerHTML = '';
  
  // 如果处于分享模式，添加分享模式的类
  if (isShareMode) {
    container.classList.add('share-mode');
  } else {
    container.classList.remove('share-mode');
  }
  
  // 创建标签列表
  const tabList = document.createElement('div');
  tabList.className = 'tab-list';
  
  // 添加顶部栏
  const header = document.createElement('div');
  header.className = 'tabs-header';
  header.innerHTML = `
    <div class="tabs-divider"></div>
    <button class="clear-button">clear</button>
  `;
  
  // 添加清除按钮事件
  const clearButton = header.querySelector('.clear-button');
  clearButton.addEventListener('click', async () => {
    try {
      const allTabs = await getCurrentTabs();
      const tabIds = allTabs.map(tab => tab.id);
      await chrome.tabs.remove(tabIds);
      // 保留一个新标签页
      await chrome.tabs.create({});
      // 重新加载列表
      const remainingTabs = await getCurrentTabs();
      renderDefaultView(remainingTabs);
    } catch (error) {
      console.error('关闭所有标签页失败:', error);
    }
  });
  
  tabList.appendChild(header);
  
  // 根据排序方式对标签页进行排序
  const sortMethod = document.getElementById('sortSelect')?.value || 'time-desc';
  const sortedTabs = sortTabs(tabs.map(tab => ({
    tab,
    newTitle: tab.title || 'New Tab',
    pinned: pinnedTabs.has(tab.id)
  })), sortMethod);
  
  console.log('排序后的标签页数量:', sortedTabs.length);
  
  // 创建临时分组用于生成图标索引
  const tempGroups = {};
  sortedTabs.forEach(({tab}) => {
    try {
      const domain = tab.url ? new URL(tab.url).hostname : 'other';
      if (!tempGroups[domain]) {
        tempGroups[domain] = [];
      }
      tempGroups[domain].push({tab, newTitle: tab.title});
    } catch (error) {
      if (!tempGroups['other']) {
        tempGroups['other'] = [];
      }
      tempGroups['other'].push({tab, newTitle: tab.title});
    }
  });
  
  // 创建图标索引
  createFaviconIndex(tempGroups);
  
  // 遍历所有标签页并创建元素
  sortedTabs.forEach(({tab, newTitle, pinned}) => {
    console.log('渲染标签页:', tab.id, tab.title);
    const tabItem = document.createElement('div');
    tabItem.className = 'tab-item';
    tabItem.setAttribute('data-tab-id', tab.id);
    
    if (isShareMode && selectedTabs.has(tab.id)) {
      tabItem.classList.add('selected');
    }
    if (pinned) {
      tabItem.classList.add('pinned');
    }
    if (tab.active) {
      tabItem.classList.add('active');
    }
    
    // 处理 favicon
    let faviconHtml = '';
    if (tab.favIconUrl) {
      faviconHtml = `<img class="tab-favicon" src="${tab.favIconUrl}" alt="" onerror="this.style.display='none'">`;
    } else {
      faviconHtml = `<div class="tab-favicon-placeholder"></div>`;
    }
    
    // 添加置顶按钮和关闭按钮
    const pinButtonHtml = `
      <div class="pin-button" title="置顶标签页">
        <svg viewBox="0 0 24 24">
          <path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z" />
        </svg>
      </div>
    `;
    
    const closeButtonHtml = `
      <div class="close-button" title="关闭标签页">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </div>
    `;
    
    tabItem.innerHTML = `
      ${faviconHtml}
      <span class="tab-title" title="${tab.title || 'New Tab'}">${newTitle}</span>
      <div class="tab-actions">
        ${pinButtonHtml}
        ${closeButtonHtml}
      </div>
    `;
    
    // 添加点击事件处理
    tabItem.addEventListener('click', (e) => {
      if (e.target.closest('.close-button')) {
        e.preventDefault();
        e.stopPropagation();
        closeTab(tab.id);
        return;
      }
      
      if (e.target.closest('.pin-button')) {
        e.preventDefault();
        e.stopPropagation();
        togglePinned(tab, tabItem);
        return;
      }
      
      if (isShareMode) {
        e.preventDefault();
        e.stopPropagation();
        handleTabClick(tabItem, tab);
      } else {
        chrome.tabs.update(tab.id, { active: true });
      }
    });
    
    tabList.appendChild(tabItem);
  });
  
  container.appendChild(tabList);
  console.log('渲染完成');
}

// 在文件顶部添加标签页切换事件监听
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // 新高亮状态
  document.querySelectorAll('.tab-item').forEach(item => {
    const tabId = parseInt(item.getAttribute('data-tab-id'));
    if (tabId === activeInfo.tabId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
});

// 添加来自background.js的消息监听
chrome.runtime.onMessage.addListener(async (message) => {
  console.log('popup：收到后台消息', message);
  
  try {
    if (message.type === 'TAB_CREATED' || message.type === 'TAB_UPDATED') {
      console.log('popup：准备更新标签页列表');
      // 等待一小段时间确保标签页状态已更新
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // 获取最新的标签页列表
      const tabs = await getCurrentTabs();
      console.log('popup：获取到标签页数量', tabs.length);
      
      // 获取容器
      const tabsContainer = document.getElementById('tabGroups');
      if (!tabsContainer) {
        console.error('popup：未找到标签页容器');
        return;
      }
      
      // 根据当前视图模式更新列表
      const isGroupView = tabsContainer.querySelector('.tab-group') !== null;
      console.log('popup：当前是否为分组视图', isGroupView);
      
      if (isGroupView) {
        console.log('popup：使用分组视图渲染');
        const groups = groupTabs(tabs);
        renderGroups(groups);
      } else {
        console.log('popup：使用默认视图渲染');
        renderDefaultView(tabs);
      }
    }
  } catch (error) {
    console.error('popup：处理后台消息失败', error);
  }
});

/**
 * 获默认设置
 * @returns {Settings}
 */
function getDefaultSettings() {
  return {
    themeMode: 'auto',
    defaultView: 'default',
  };
}

/**
 * 渲染设置界面
 * @param {Settings} settings
 */
function renderSettings(settings) {
  console.log('popup：渲染设置:', settings);
  const themeModeSelect = document.getElementById('themeMode');
  const defaultViewSelect = document.getElementById('defaultView');
  
  if (themeModeSelect) {
    themeModeSelect.value = settings.themeMode;
  } else {
    console.error('popup：未找到主题模式选择器');
  }
  
  if (defaultViewSelect) {
    defaultViewSelect.value = settings.defaultView;
  } else {
    console.error('popup：未找到默认视图选择器');
  }
}

/**
 * 应用主题模式
 * @param {string} mode
 */
function applyThemeMode(mode) {
  if (mode === 'auto') {
    // 检测系统主题
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
  } else if (mode === 'dark') {
    document.body.classList.add('dark-mode');
  } else {
    document.body.classList.remove('dark-mode');
  }
}

// 监听系统主题变化
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async (e) => {
  const settings = await chrome.storage.local.get('settings');
  if (settings.themeMode === 'auto') {
    applyThemeMode('auto');
  }
});

/**
 * 更新标签页列表
 */
async function updateTabsList() {
  try {
    console.log('开始更新标签页列表');
    const tabs = await getCurrentTabs();
    console.log('获取到标签页数量:', tabs.length);
    
    const tabsContainer = document.getElementById('tabGroups');
    if (!tabsContainer) {
      console.error('未找到标签页容器');
      return;
    }
    
    // 直接使用默认视图
    console.log('使用默认视图渲染');
    renderDefaultView(tabs);
    console.log('渲染完成');
  } catch (error) {
    console.error('更新标签页列表失败:', error);
  }
}

/**
 * 切换视图模式
 * @param {string} mode - 视图模式：'default'|'domain'|'ai'
 */
async function switchView(mode) {
  try {
    // 更新按钮样式
    const defaultButton = document.getElementById('defaultView');
    const groupButton = document.getElementById('groupTabs');
    const aiButton = document.getElementById('aiGroupTabs');
    
    // 移除所有按钮的active类
    defaultButton.classList.remove('active');
    groupButton.classList.remove('active');
    aiButton.classList.remove('active');
    
    // 根据模式添加active类
    if (mode === 'default') {
      defaultButton.classList.add('active');
    } else if (mode === 'domain') {
      groupButton.classList.add('active');
    } else if (mode === 'ai') {
      aiButton.classList.add('active');
    }
    
    const tabs = await getCurrentTabs();
    if (mode === 'domain') {
      const groups = groupTabs(tabs);
      renderGroups(groups);
    } else if (mode === 'ai') {
      const button = document.getElementById('aiGroupTabs');
      if (button) {
        button.classList.add('loading');
        button.textContent = 'AI分组中...';
      }
      try {
        await aiGroupTabs(tabs);
      } catch (error) {
        console.error('AI分组失败:', error);
        alert('AI分组失败，已回退到普通分组');
        const groups = groupTabs(tabs);
        renderGroups(groups);
      } finally {
        if (button) {
          button.classList.remove('loading');
          button.textContent = 'AI智能分组';
        }
      }
    } else {
      renderDefaultView(tabs);
    }
  } catch (error) {
    console.error('切换视图失败:', error);
  }
}

/**
 * 切换分享模式
 */
function toggleShareMode() {
  const shareOverlay = document.getElementById('shareOverlay');
  if (shareOverlay) {
    const isVisible = shareOverlay.style.display === 'flex';
    shareOverlay.style.display = isVisible ? 'none' : 'flex';
    isShareMode = !isVisible;
    
    // 重置选中状态
    if (!isVisible) {
      selectedTabs.clear();
      document.getElementById('selectedCount').textContent = '已选择 0 项';
    }
  }
}

/**
 * 切换设置面板
 */
function toggleSettings() {
  const settingsOverlay = document.getElementById('settingsOverlay');
  if (settingsOverlay) {
    const isVisible = settingsOverlay.style.display === 'flex';
    settingsOverlay.style.display = isVisible ? 'none' : 'flex';
    
    // 如果打开设置面板，则加载当前设置
    if (!isVisible) {
      document.getElementById('themeMode').value = settings.themeMode;
      document.getElementById('defaultView').value = settings.defaultView;
    }
  }
}

/**
 * 处理搜索
 * @param {Event} event - 输入事件
 */
function handleSearch(event) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    searchTabs(event.target.value);
  }, 300);
}

/**
 * 处理排序
 * @param {Event} event - 变更事件
 */
async function handleSort(event) {
  const tabs = await getCurrentTabs();
  const isGroupView = document.querySelector('.tab-group') !== null;
  
  if (isGroupView) {
    const groups = groupTabs(tabs);
    renderGroups(groups);
  } else {
    renderDefaultView(tabs);
  }
}

/**
 * 复制选中的标签页链接
 */
async function copySelectedTabs() {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const selectedUrls = tabs
      .filter(tab => selectedTabs.has(tab.id))
      .map(tab => tab.url)
      .join('\n');
    
    if (selectedUrls) {
      await navigator.clipboard.writeText(selectedUrls);
      alert('已复制选中标签页的链接！');
      toggleShareMode();
    } else {
      alert('请先选择要分享的标签页！');
    }
  } catch (error) {
    console.error('复制失败:', error);
    alert('复制失败，请重试');
  }
} 