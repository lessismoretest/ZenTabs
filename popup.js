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
 * @typedef {Object} ArchivedTab
 * @property {string} title - 标签页标题
 * @property {string} url - 标签页URL
 * @property {string} favIconUrl - 标签页图标URL
 * @property {number} timestamp - 归档时间戳
 */

/**
 * @typedef {Object} ClosedTab
 * @property {string} title - 标签页标题
 * @property {string} url - 标签页URL
 * @property {string} favIconUrl - 标签页图标URL
 * @property {number} timestamp - 关闭时间戳
 */

// 在文件顶部定义标签颜色选择下拉菜单的 HTML 模板
const tagDropdownHtml = `
  <div class="tag-dropdown">
    <div class="tag-color clear" data-color="" title="取消标签">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    </div>
    <div class="tag-color red" data-color="red"></div>
    <div class="tag-color orange" data-color="orange"></div>
    <div class="tag-color yellow" data-color="yellow"></div>
    <div class="tag-color green" data-color="green"></div>
    <div class="tag-color blue" data-color="blue"></div>
    <div class="tag-color purple" data-color="purple"></div>
    <div class="tag-color gray" data-color="gray"></div>
  </div>
`;

// 在文件顶部添加变量
let currentSelectedColor = null;

/**
 * @type {Settings}
 */
let settings = getDefaultSettings();

// 在文件顶部添加变量
const MAX_CLOSED_TABS = 20;
let closedTabs = [];

// 添加缓存相关常量
const AI_CACHE_TIMEOUT = 5 * 60 * 1000; // 5分钟缓存
let lastAiGroupResult = null;
let lastAiGroupTime = 0;

// 添加新的常量和变量
const AUTO_REGROUP_THRESHOLD = 5; // 触发自动重新分组的新标签页数量阈值
let newTabsCount = 0; // 新增标签页计数器

// 在文件顶部导入
import { MODEL_CONFIGS, callAIModel, extractJsonFromResponse } from './models.js';

// 全局变量声明
let isShareMode = false;
let selectedTabs = new Set();

// 在文件顶部添加变量声明
let searchTimeout = null;
let searchInputElem = null;  // 用于存储搜索输入框元素

/**
 * 初始化应用
 */
async function initialize() {
  console.log('popup：开始初始化');
  try {
    console.log('正在加载设置...');
    // 加载设置
    const data = await chrome.storage.local.get('settings');
    settings = { ...getDefaultSettings(), ...data.settings };
    
    console.log('正在应用主题...');
    // 应用主题
    applyThemeMode(settings.themeMode);
    
    console.log('正在渲染设置...');
    // 渲染设置
    renderSettings(settings);
    
    console.log('正在获取当前标签页...');
    // 获取当前标签页URL并设置到搜索框
    const [activeTab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    });
    
    if (activeTab && activeTab.url) {
      searchInputElem = document.getElementById('searchInput');
      if (searchInputElem) {
        searchInputElem.value = activeTab.url;
        console.log('当前标签页URL:', activeTab.url);
      }
    }
    
    console.log('正在获取所有标签页...');
    // 获取并显示当前标签页
    const tabs = await getCurrentTabs();
    console.log('popup：初始化时获取到标签页数量:', tabs.length);
    
    console.log('正在切换视图...');
    // 根据默认视图设置渲染
    if (settings.defaultView === 'ai') {
      await switchView('ai');
    } else {
      await switchView('default');
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

let refreshTimeout = null;

function setupAutoRefresh() {
  console.log('popup：设置自动刷新');
  
  async function refresh() {
    try {
      // 如果正在从归档视图恢复标签页，不执行刷新
      if (isRestoringFromArchive) {
        return;
      }

      // 获取归档按钮状态
      const archiveListButton = document.getElementById('archiveListButton');
      const isInArchivedView = archiveListButton && archiveListButton.classList.contains('active');
      
      // 如果在归档视图中，不执行刷新
      if (isInArchivedView) {
        return;
      }

      // 获取当前视图模式
      const defaultButton = document.getElementById('defaultView');
      const groupButton = document.getElementById('groupTabs');
      const aiButton = document.getElementById('aiGroupTabs');
      
      // 获取当前激活的视图按钮
      let currentView = 'default';
      if (groupButton.classList.contains('active')) {
        currentView = 'domain';
      } else if (aiButton.classList.contains('active')) {
        currentView = 'ai';
      }

      // 先获取存储的标签颜色
      const result = await chrome.storage.local.get(['tabTags']);
      const tabTags = result.tabTags || {};
      
      const tabs = await getCurrentTabs();
      const tabsContainer = document.getElementById('tabGroups');
      
      if (!tabsContainer) {
        console.error('popup：未找到标签页容器');
        return;
      }

      // 使用 switchView 函数来保持当前视图状态
      await switchView(currentView);

      // 在渲染完成后恢复所有标签颜色
      Object.entries(tabTags).forEach(([tabId, color]) => {
        const tabItem = document.querySelector(`.tab-item[data-tab-id="${tabId}"]`);
        if (tabItem) {
          tabItem.dataset.tagColor = color;
        }
      });

      // 更新颜色筛选器
      createColorFilter(tabTags);
    } catch (error) {
      console.error('popup：自动刷新失败:', error);
    }
  }

  // 使用防抖处理刷新，延长刷新间隔
  setInterval(() => {
    if (refreshTimeout) {
      clearTimeout(refreshTimeout);
    }
    refreshTimeout = setTimeout(refresh, 2000);
  }, 2000);
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
    const tabElement = createTabElement(tab, false);  // 添加 false 参数表示非归档标签页
    tabList.appendChild(tabElement);
  });
}

/**
 * 创建标签页元素
 * @param {Tab} tab - 标签页数据
 * @param {boolean} [isArchived=false] - 是否为归档的标签页
 * @returns {HTMLElement} 标签页元素
 */
function createTabElement(tab, isArchived = false) {
  const tabItem = document.createElement('div');
  tabItem.className = 'tab-item';
  tabItem.setAttribute('data-tab-id', tab.id);
  
  // 添加复选框（仅在分享模式下显示）
  const checkbox = document.createElement('div');
  checkbox.className = 'tab-checkbox';
  tabItem.appendChild(checkbox);
  
  // 添加图标
  const favicon = document.createElement('img');
  favicon.className = 'tab-favicon';
  favicon.src = tab.favIconUrl || 'icons/default-favicon.png';
  favicon.onerror = () => {
    favicon.src = 'icons/default-favicon.png';
  };
  tabItem.appendChild(favicon);
  
  // 添加标题
  const title = document.createElement('span');
  title.className = 'tab-title';
  title.textContent = tab.title;
  tabItem.appendChild(title);
  
  // 添加关闭按钮
  if (!isArchived) {
    const closeButton = document.createElement('button');
    closeButton.className = 'close-button';
    closeButton.innerHTML = '×';
    closeButton.title = '关闭标签页';
    closeButton.onclick = async (e) => {
      e.stopPropagation();
      await closeTab(tab.id);
    };
    tabItem.appendChild(closeButton);
  }
  
  // 添加点击事件
  tabItem.addEventListener('click', async () => {
    if (!handleTabClick(tabItem, tab)) {
      if (isArchived) {
        await restoreArchivedTab(tab);
      } else {
        await chrome.tabs.update(tab.id, { active: true });
        window.close();
      }
    }
  });
  
  // 添加双击事件
  if (!isArchived && settings.doubleClickToClose) {
    tabItem.addEventListener('dblclick', async (e) => {
      e.stopPropagation();
      await closeTab(tab.id);
    });
  }
  
  // 添加拖拽功能
  if (!isArchived) {
    initDragAndDrop(tabItem);
  }
  
  return tabItem;
}


// 当文档加载完成时初始化
document.addEventListener('DOMContentLoaded', async () => {
  console.log('popup：DOM加载完成');
  try {
    // 先初始化
    await initialize();
    
    // 从storage加载closedTabs
    const result = await chrome.storage.local.get(['closedTabs']);
    closedTabs = result.closedTabs || [];
    
    // 恢复按钮点击事件
    document.getElementById('restoreButton').addEventListener('click', restoreClosedTab);
    document.getElementById('shareButton').addEventListener('click', toggleShareMode);
  } catch (error) {
    console.error('popup：初始化失败:', error);
  }
});

/**
 * 获取当前窗口的所有标签页
 * @returns {Promise<Array<chrome.tabs.Tab>>} 标签页数组
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
      const url = new URL(tab.url);
      let domain;
      
      // 如果是 chrome:// 开头的URL，统一归类到 chrome 组
      if (url.protocol === 'chrome:') {
        domain = 'chrome';
      } else {
        domain = url.hostname;
      }
      
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
    // 分别对置顶和非置顶标签进行排序
    const pinnedTabs = sortedTabs.filter(item => item.pinned);
    const unpinnedTabs = sortedTabs.filter(item => !item.pinned);
    
    // 分别对置顶和非置顶标签应用相同的排序规则
    const sortedPinnedTabs = sortTabs(pinnedTabs, sortMethod);
    const sortedUnpinnedTabs = sortTabs(unpinnedTabItems, sortMethod);
    
    // 合并排序后的结果，置顶标签在前
    groups[domain] = [...sortedPinnedTabs, ...sortedUnpinnedTabs];
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
      // 查找该字开头的第一个分组
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
    
    // 如果是当前选中的域名，active类
    if (groupName === currentSelectedDomain) {
      indexItem.classList.add('active');
    }
    
    // 创建图标占位符
    if (firstTab.url === 'chrome://newtab/' || !firstTab.favIconUrl) {
      indexItem.innerHTML = `
        <svg class="tab-favicon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg">
          <path d="M258.016 447.008L112 192.992Q183.008 102.976 288 51.488T512 0q138.016 0 255.488 68t185.504 183.008H534.976q-11.008-0.992-23.008-0.992-90.016 0-160.992 55.488t-92.992 141.504z m436.992-122.016h294.016q35.008 90.016 35.008 187.008 0 103.008-40 197.504t-107.488 163.008-161.504 109.504-196.992 42.016l208.992-363.008q47.008-67.008 47.008-148.992 0-110.016-79.008-187.008zM326.016 512q0-76.992 54.496-131.488T512 326.016t131.488 54.496T697.984 512t-54.496 131.488T512 697.984t-131.488-54.496T326.016 512z m256 252.992l-146.016 252.992q-122.016-18.016-222.016-88.992t-156.992-180.992T0 512q0-135.008 66.016-251.008l208.992 362.016q32 68 96 109.504T512 774.016q36 0 70.016-8.992z" fill="#606367"/>
        </svg>`;
    } else {
      const img = document.createElement('img');
      img.src = firstTab.favIconUrl;
      img.alt = '';
      img.onerror = () => {
        img.style.display = 'none';
        indexItem.innerHTML = '<div class="favicon-placeholder"></div>';
      };
      indexItem.appendChild(img);
    }
    
    // 添加点击事件
    indexItem.addEventListener('click', () => {
      // 如果点击的是当前选中的域名，则取消选择
      if (groupName === currentSelectedDomain) {
        currentSelectedDomain = null;
        // 移除所有图标的active类
        document.querySelectorAll('.favicon-item').forEach(item => {
          item.classList.remove('active');
        });
        
        // 显示所有标签页或组
        const tabsContainer = document.getElementById('tabGroups');
        const isGroupView = tabsContainer.querySelector('.tab-group') !== null;

        if (isGroupView) {
          document.querySelectorAll('.tab-group').forEach(group => {
            group.style.display = '';
          });
        } else {
          document.querySelectorAll('.tab-item').forEach(item => {
            item.style.display = '';
          });
        }
        return;
      }

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
    
    // 移除所有标的高亮
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
  
  // 获取所有分组名称并排序，但确保"未分类"始终在最前
  const groupNames = Object.keys(groups).sort((a, b) => {
    // 如果其中一个是"未分类"，它应该排在最前面
    if (a === '未分类') return -1;
    if (b === '未分类') return 1;
    
    // 其他情况按照原有的排序逻辑
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
  
  // 使用公共的顶部栏创建函数
  const header = createHeader();
  container.appendChild(header);
  
  // 为每个组分配一个固定的颜色
  const groupColors = {};
  const availableColors = Object.keys(GROUP_COLORS);
  groupNames.forEach((groupName, index) => {
    groupColors[groupName] = availableColors[index % availableColors.length];
  });
  
  // 渲染分组
  groupNames.forEach(groupName => {
    const items = groups[groupName];
    const groupElement = document.createElement('div');
    groupElement.className = 'tab-group';
    groupElement.id = `group-${groupName}`;
    
    const header = document.createElement('div');
    header.className = 'group-header';
    
    // 获取该组的颜色
    const color = groupColors[groupName];
    
    header.innerHTML = `
      <div class="group-header-content" style="color: ${GROUP_COLORS[color]}; background-color: #f1f3f4; border-radius: 4px; padding: 4px 8px;">
        <span class="group-toggle">
          <svg class="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </span>
        <span class="group-title">${groupName}</span>
        <span class="tab-count">${items.length}</span>
      </div>
    `;
    
    // 添加分组标题点击事件
    const headerContent = header.querySelector('.group-header-content');
    headerContent.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const tabList = groupElement.querySelector('.tab-list');
      const chevron = header.querySelector('.chevron-icon');
      
      if (tabList.style.display === 'none') {
        // 展开
        tabList.style.display = '';
        chevron.style.transform = 'rotate(0deg)';
        groupElement.classList.remove('collapsed');
      } else {
        // 收起
        tabList.style.display = 'none';
        chevron.style.transform = 'rotate(-90deg)';
        groupElement.classList.add('collapsed');
      }
    });

    const tabList = document.createElement('div');
    tabList.className = 'tab-list';
    
    items.forEach(({tab, newTitle}) => {
      const tabItem = document.createElement('div');
      tabItem.className = 'tab-item';
      tabItem.setAttribute('data-tab-id', tab.id);
      
      // 处理 favicon
      let faviconHtml = '';
      if (tab.url === 'chrome://newtab/' || !tab.favIconUrl) {
        faviconHtml = `
          <svg class="tab-favicon" viewBox="0 0 1024 1024">
            <path d="M258.016 447.008L112 192.992Q183.008 102.976 288 51.488T512 0q138.016 0 255.488 68t185.504 183.008H534.976q-11.008-0.992-23.008-0.992-90.016 0-160.992 55.488t-92.992 141.504z m436.992-122.016h294.016q35.008 90.016 35.008 187.008 0 103.008-40 197.504t-107.488 163.008-161.504 109.504-196.992 42.016l208.992-363.008q47.008-67.008 47.008-148.992 0-110.016-79.008-187.008zM326.016 512q0-76.992 54.496-131.488T512 326.016t131.488 54.496T697.984 512t-54.496 131.488T512 697.984t-131.488-54.496T326.016 512z m256 252.992l-146.016 252.992q-122.016-18.016-222.016-88.992t-156.992-180.992T0 512q0-135.008 66.016-251.008l208.992 362.016q32 68 96 109.504T512 774.016q36 0 70.016-8.992z" fill="#5f6368"/>
          </svg>`;
      } else {
        faviconHtml = `<img class="tab-favicon" src="${tab.favIconUrl}" alt="" onerror="this.style.display='none'">`;
      }
      
      tabItem.innerHTML = `
        <div class="icon-wrapper">
          ${faviconHtml}
        </div>
        <span class="tab-title" title="${tab.title}">${newTitle}</span>
        <div class="tab-actions">
          <button class="tag-button" title="设置标签"></button>
          ${tagDropdownHtml}
          <button class="pin-button" title="置顶标签页">
            <svg viewBox="0 0 24 24">
              <path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z" />
            </svg>
          </button>
          <button class="close-button" title="关闭标签页">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 6l12 12M6 18L18 6"/>
            </svg>
          </button>
        </div>
      `;
      
      // 添加双击标题关闭标签页功能
      const titleElement = tabItem.querySelector('.tab-title');
      titleElement.addEventListener('dblclick', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        try {
          // 获取设置并检查是否启用双击关闭
          const { settings } = await chrome.storage.local.get('settings');
          if (settings?.doubleClickToClose) {
            // 先关闭标签页
            await chrome.tabs.remove(tab.id);
            
            // 更新AI分组缓存
            updateAiGroupCache(tab.id);
            
            // 更新 UI
            const parentGroup = tabItem.closest('.tab-group');
            if (parentGroup) {
              // 移除标签页元素
              tabItem.remove();
              
              // 获取剩余的标签页
              const remainingTabs = parentGroup.querySelectorAll('.tab-item');
              
              // 更新分组的标签数量
              const tabCount = parentGroup.querySelector('.tab-count');
              if (tabCount) {
                tabCount.textContent = remainingTabs.length;
              }
              
              // 如果分组为空，移除整个分组
              if (remainingTabs.length === 0) {
                parentGroup.remove();
              }
            }
            
            // 更新总标签数
            updateTabCount();
          }
        } catch (error) {
          console.error('关闭标签页失败:', error);
        }
      });
      
      // 添加标签按钮点击事件
      const tagButton = tabItem.querySelector('.tag-button');
      const tagDropdown = tabItem.querySelector('.tag-dropdown');
      
      tagButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // 关闭其他所有下拉菜单
        document.querySelectorAll('.tag-dropdown.show').forEach(dropdown => {
          if (dropdown !== tagDropdown) {
            dropdown.classList.remove('show');
          }
        });
        
        // 切换当前下拉菜单
        const isVisible = tagDropdown.classList.contains('show');
        if (!isVisible) {
          // 确保在显示之前其他所有下拉菜单都已关闭
          document.querySelectorAll('.tag-dropdown.show').forEach(dropdown => {
            dropdown.classList.remove('show');
          });
        }
        tagDropdown.classList.toggle('show');
      });
      
      // 颜色选择事件
      const tagColors = tabItem.querySelectorAll('.tag-color');
      tagColors.forEach(color => {
        color.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const selectedColor = color.dataset.color;
          
          // 保存标签颜色到存储
          chrome.storage.local.get(['tabTags'], (result) => {
            const tabTags = result.tabTags || {};
            tabTags[tab.id] = selectedColor;
            chrome.storage.local.set({ tabTags }, () => {
              // 确保颜色保存后立即应用
              tabItem.dataset.tagColor = selectedColor;
              
              // 立即更新颜色筛选器
              createColorFilter(tabTags);
            });
          });
          
          // 关闭颜色选择器
          tagDropdown.classList.remove('show');
        });
      });
      
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
    
    groupElement.appendChild(header);
    groupElement.appendChild(tabList);
    container.appendChild(groupElement);
  });
  
  // 获取当前标签颜色
  chrome.storage.local.get(['tabTags'], (result) => {
    const tabTags = result.tabTags || {};
    createColorFilter(tabTags);
  });
}

/**
 * 获取随机颜色
 * @returns {string} Chrome标签组颜色
 */
function getRandomColor() {
  const colors = [
    'grey',
    'blue',
    'red',
    'yellow',
    'green',
    'pink',
    'purple',
    'cyan'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

/**
 * 初始化所有事件监听器
 */
function initializeEventListeners() {
  // 监听标签页切换事件
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      if (tab && tab.url) {
        const searchInput = document.getElementById('searchInput');
        searchInput.value = tab.url;
      }
    } catch (error) {
      console.error('获取活动标签页失败:', error);
    }
  });

  // 监听标签页更新事件
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    try {
      // 更新搜索框URL
      if (changeInfo.url && tab.active) {
        const searchInput = document.getElementById('searchInput');
        searchInput.value = changeInfo.url;
      }

      // 获取当前视图模式
      const defaultButton = document.getElementById('defaultView');
      const aiButton = document.getElementById('aiGroupTabs');
      
      // 获取当前激活的视图按钮
      let currentView = 'default';
      if (aiButton && aiButton.classList.contains('active')) {
        currentView = 'ai';
      }

      // 如果是AI视图，并且有缓存结果，直接使用缓存
      if (currentView === 'ai' && lastAiGroupResult) {
        renderGroups(lastAiGroupResult);
        return;
      }

      // 重新渲染当前视图
      await switchView(currentView);
    } catch (error) {
      console.error('处理标签页更新失败:', error);
    }
  });

  // 监听标签页创建事件
  chrome.tabs.onCreated.addListener(async (tab) => {
    try {
      // 获取当前视图模式
      const defaultButton = document.getElementById('defaultView');
      const aiButton = document.getElementById('aiGroupTabs');
      
      // 获取当前激活的视图按钮
      let currentView = 'default';
      if (aiButton && aiButton.classList.contains('active')) {
        currentView = 'ai';
      }

      // 如果是AI视图，并且有缓存结果，直接使用缓存
      if (currentView === 'ai' && lastAiGroupResult) {
        renderGroups(lastAiGroupResult);
        return;
      }

      // 重新渲染当前视图
      await switchView(currentView);
    } catch (error) {
      console.error('处理新标签页创建失败:', error);
    }
  });

  // 监听标签页关闭事件
  chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    try {
      // 如果正在从归档视图中恢复标签页，不执行任何操作
      if (isRestoringFromArchive || isShowingArchived) {
        return;
      }

      // 获取当前视图模式
      const defaultButton = document.getElementById('defaultView');
      const aiButton = document.getElementById('aiGroupTabs');
      
      // 获取当前激活的视图按钮
      let currentView = 'default';
      if (aiButton && aiButton.classList.contains('active')) {
        currentView = 'ai';
      }
      
      // 获取存储的标签颜色
      const result = await chrome.storage.local.get(['tabTags']);
      const tabTags = result.tabTags || {};
      
      // 删除已关闭标签页的颜色标记
      delete tabTags[tabId];
      await chrome.storage.local.set({ tabTags });

      // 如果是AI视图，更新缓存
      if (currentView === 'ai') {
        updateAiGroupCache(tabId);
        if (lastAiGroupResult) {
          renderGroups(lastAiGroupResult);
          return;
        }
      }
      
      // 重新渲染当前视图
      await switchView(currentView);
      
      // 恢复所有标签颜色
      Object.entries(tabTags).forEach(([tabId, color]) => {
        const tabItem = document.querySelector(`.tab-item[data-tab-id="${tabId}"]`);
        if (tabItem) {
          tabItem.dataset.tagColor = color;
        }
      });
      
      // 更新颜色筛选器
      createColorFilter(tabTags);
    } catch (error) {
      console.error('处理标签页关闭失败:', error);
    }
  });

  console.log('开始初始化事件监听器');
  
  // 搜索输入框
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    console.log('找到搜索输入框，绑定事件');
    searchInput.addEventListener('input', (e) => {
      console.log('搜索输入:', e.target.value);
      handleSearch(e);
    });
  } else {
    console.error('未找到搜索输入框元素');
  }

  // 复制链接按钮
  const copyButton = document.querySelector('.copy-url-button');
  if (copyButton) {
    console.log('找到复制按钮，绑定事件');
    copyButton.addEventListener('click', async () => {
      try {
        const searchInput = document.getElementById('searchInput');
        const url = searchInput.value;
        await navigator.clipboard.writeText(url);
        console.log('复制成功:', url);
        
        // 视觉反馈
        copyButton.style.color = '#4CAF50';
        setTimeout(() => {
          copyButton.style.color = '';
        }, 1000);
      } catch (error) {
        console.error('复制失败:', error);
      }
    });
  } else {
    console.error('未找到复制按钮元素');
  }

  // 视图切换按钮
  document.getElementById('defaultView').addEventListener('click', () => switchView('default'));
  document.getElementById('aiGroupTabs').addEventListener('click', async () => {
    const button = document.getElementById('aiGroupTabs');
    button.classList.add('loading');
    button.textContent = 'AI分组中...';
    
    try {
      await switchView('ai');
    } catch (error) {
      console.error('AI分组失败:', error);
      alert('AI分组失败，请重试');
    } finally {
      button.classList.remove('loading');
      button.textContent = 'AI智能分组';
    }
  });
  
  // 新建标签页按钮
  document.getElementById('newTabButton').addEventListener('click', () => {
    chrome.tabs.create({});
  });
  
  // 分享按钮
  document.getElementById('shareButton').addEventListener('click', toggleShareMode);
  
  // 设置按钮
  document.getElementById('settingsButton').addEventListener('click', toggleSettings);
  
  // 排序选择
  document.getElementById('sortSelect').addEventListener('change', handleSort);
  
  // 设置面板按钮
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
  document.getElementById('cancelSettings').addEventListener('click', toggleSettings);
  document.querySelector('.close-settings').addEventListener('click', toggleSettings);
  
  // 分享面板按钮
  document.getElementById('copySelected').addEventListener('click', copySelectedTabs);
  document.getElementById('cancelShare').addEventListener('click', toggleShareMode);
  
  // 音频按钮点击事件
  document.getElementById('audioButton').addEventListener('click', async () => {
    try {
      // 切换筛选状态
      isAudioFilterActive = !isAudioFilterActive;
      const audioButton = document.getElementById('audioButton');
      
      // 获取所有标签页
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const audibleTabs = tabs.filter(tab => tab.audible);
      
      // 更新按钮状态
      if (isAudioFilterActive) {
        audioButton.classList.add('active');
        audioButton.title = `正在播放 (${audibleTabs.length})`;
        
        // 隐藏非播放中的标签页
        document.querySelectorAll('.tab-item').forEach(item => {
          const tabId = parseInt(item.getAttribute('data-tab-id'));
          const isAudible = audibleTabs.some(tab => tab.id === tabId);
          item.style.display = isAudible ? '' : 'none';
        });
        
        // 如果是分组视图，隐藏空组
        document.querySelectorAll('.tab-group').forEach(group => {
          const hasVisibleTabs = Array.from(group.querySelectorAll('.tab-item'))
            .some(item => item.style.display !== 'none');
          group.style.display = hasVisibleTabs ? '' : 'none';
        });
      } else {
        audioButton.classList.remove('active');
        audioButton.title = '正在播放';
        
        // 显示所有标签页
        document.querySelectorAll('.tab-item').forEach(item => {
          item.style.display = '';
        });
        
        // 显示所有分组
        document.querySelectorAll('.tab-group').forEach(group => {
          group.style.display = '';
        });
      }
    } catch (error) {
      console.error('音频筛选失败:', error);
    }
  });
  
  console.log('事件监听器初始化完成');

  // 添加搜索事件监听
  searchInputElem = document.getElementById('searchInput');
  if (searchInputElem) {
    searchInputElem.addEventListener('input', handleSearch);
    console.log('搜索事件监听器已绑定');
  } else {
    console.error('未找到搜索输入框');
  }
}

/**
 * 切换分享模式
 */
function toggleShareMode() {
  const shareOverlay = document.getElementById('shareOverlay');
  const container = document.getElementById('tabGroups');
  
  if (shareOverlay) {
    const isVisible = shareOverlay.style.display === 'flex';
    shareOverlay.style.display = isVisible ? 'none' : 'flex';
    isShareMode = !isVisible;
    
    if (container) {
      if (isShareMode) {
        container.classList.add('share-mode');
      } else {
        container.classList.remove('share-mode');
      }
    }
    
    // 重置选中状态
    selectedTabs.clear();
    document.getElementById('selectedCount').textContent = '已选择 0 项';
    
    // 重新渲染以更新复选框状态
    getCurrentTabs().then(tabs => {
      const isGroupView = container.querySelector('.tab-group') !== null;
      if (isGroupView) {
        const groups = groupTabs(tabs);
        renderGroups(groups);
      } else {
        renderDefaultView(tabs);
      }
    });
  }
}

/**
 * 更新选中计数
 */
function updateSelectedCount() {
  const countElement = document.getElementById('selectedCount');
  countElement.textContent = `已选 ${selectedTabs.size} 项`;
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
  
  // 先获取所有标签的颜色标记
  chrome.storage.local.get(['tabTags'], async (result) => {
    const tabTags = result.tabTags || {};
    
    // 获取当前视图模式
    const tabsContainer = document.getElementById('tabGroups');
    const isGroupView = tabsContainer.querySelector('.tab-group') !== null;
    
    // 获取当前标签页列表
    const tabs = await getCurrentTabs();
    
    // 根据当前视图模式重新渲染
    if (isGroupView) {
      const groups = groupTabs(tabs);
      renderGroups(groups);
    } else {
      renderDefaultView(tabs);
    }
    
    // 恢复所有标签颜色
    Object.entries(tabTags).forEach(([tabId, color]) => {
      const tabItem = document.querySelector(`.tab-item[data-tab-id="${tabId}"]`);
      if (tabItem) {
        tabItem.dataset.tagColor = color;
      }
    });
    
    // 更新颜色筛选器
    createColorFilter(tabTags);
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
    
    // 如果当不是侧边栏模式，则关闭当前窗打开侧边栏
    if (window.location.hash !== '#sidepanel') {
      await chrome.sidePanel.open();
      window.close();
    }
  } catch (error) {
    console.error('设置侧边栏位置失败:', error);
  }
}

/**
 * 修改保存设置函数
 */
async function saveSettings() {
  try {
    settings.themeMode = document.getElementById('themeMode').value;
    settings.defaultView = document.getElementById('defaultView').value;
    settings.modelType = document.getElementById('modelType').value;
    settings.apiKey = document.getElementById('apiKey').value;
    settings.doubleClickToClose = document.getElementById('doubleClickToClose').value === 'true';
    
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
  const normalizedQuery = query.toLowerCase().trim();
  const tabItems = document.querySelectorAll('.tab-item');
  
  tabItems.forEach(item => {
    const title = item.querySelector('.tab-title').textContent.toLowerCase();
    const isMatch = title.includes(normalizedQuery);
    item.style.display = isMatch ? '' : 'none';
  });
  
  // 在分组视图中，隐藏空组
  document.querySelectorAll('.tab-group').forEach(group => {
    const hasVisibleTabs = Array.from(group.querySelectorAll('.tab-item'))
      .some(item => item.style.display !== 'none');
    group.style.display = hasVisibleTabs ? '' : 'none';
  });
  
  // 更新计数
  updateTabCount();
}

/**
 * 处理搜索
 * @param {Event} event - 输入事件
 */
function handleSearch(event) {
  try {
    console.log('搜索输入事件触发，值:', event.target.value);
    
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      console.log('执行延迟搜索，值:', event.target.value);
      searchTabs(event.target.value);
    }, 300);
  } catch (error) {
    console.error('处理搜索输入时发生错误:', error);
  }
}

/**
 * 高亮文本的匹配部分
 * @param {string} text - 原始文本
 * @param {string} term - 需要高亮的关键词
 * @returns {string} 带有高亮标的HTML
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
    searchInputElem = document.getElementById('searchInput');
    if (searchInputElem) {
      searchInputElem.focus();
    }
  }
  
  // ESC 清空搜索
  const activeElement = document.activeElement;
  if (e.key === 'Escape' && activeElement === searchInputElem) {
    activeElement.value = '';
    searchTabs('');
    activeElement.blur();
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
    
    // 等待标签页完全载
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
    // 获取标签页信息并保存到closedTabs
    const tab = await chrome.tabs.get(tabId);
    const closedTab = {
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl,
      timestamp: Date.now()
    };
    
    // 添加到closedTabs数组开头
    closedTabs.unshift(closedTab);
    
    // 保持最大数量为20
    if (closedTabs.length > MAX_CLOSED_TABS) {
      closedTabs = closedTabs.slice(0, MAX_CLOSED_TABS);
    }
    
    // 保存到storage
    await chrome.storage.local.set({ closedTabs });
    
    // 更新AI分组缓存
    updateAiGroupCache(tabId);
    
    // 获取存储的标签颜色
    const result = await chrome.storage.local.get(['tabTags']);
    const tabTags = result.tabTags || {};
    
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
      console.log('使用默认视图渲染');
      renderDefaultView(tabs);
      
      // 如果有选中的域名，重新应用筛选
      if (currentSelectedDomain) {
        document.querySelectorAll('.tab-item').forEach(item => {
          try {
            const tabId = parseInt(item.getAttribute('data-tab-id'));
            const domain = new URL(tabs.find(t => t.id === tabId)?.url || '').hostname;
            if (domain === currentSelectedDomain) {
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
    
    // 恢复所有标签颜色
    Object.entries(tabTags).forEach(([tabId, color]) => {
      const tabItem = document.querySelector(`.tab-item[data-tab-id="${tabId}"]`);
      if (tabItem) {
        tabItem.dataset.tagColor = color;
      }
    });
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
 * 载访问记录
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
  container.innerHTML = '';
  
  // 如果处于分享模式，添加分享模式的类
  if (isShareMode) {
    container.classList.add('share-mode');
  } else {
    container.classList.remove('share-mode');
  }
  
  // 使用公共的顶部栏创建函数
  const header = createHeader();
  container.appendChild(header);
  
  // 创建标签列表
  const tabList = document.createElement('div');
  tabList.className = 'tab-list';
  
  // 将标签页分为置顶和非置顶两组
  const sortMethod = document.getElementById('sortSelect')?.value || 'time-desc';
  const allTabs = tabs.map(tab => ({
    tab,
    newTitle: tab.title || 'New Tab',
    pinned: pinnedTabs.has(tab.id)
  }));
  
  // 分别对置顶和非置顶标签进行排序
  const pinnedTabItems = allTabs.filter(item => item.pinned);
  const unpinnedTabItems = allTabs.filter(item => !item.pinned);
  
  // 分别应用排序
  const sortedPinnedTabs = sortTabs(pinnedTabItems, sortMethod);
  const sortedUnpinnedTabs = sortTabs(unpinnedTabItems, sortMethod);
  
  // 合并排序后的结果，置顶标签在前
  const sortedTabs = [...sortedPinnedTabs, ...sortedUnpinnedTabs];
  
  console.log('排序后的标签页数量:', sortedTabs.length);
  
  // 创建临时分组用于生成标索引
  const tempGroups = {};
  sortedTabs.forEach(({tab}) => {
    try {
      const url = new URL(tab.url);
      let domain;
      
      // 如果是 chrome:// 开头的URL，统一归类到 chrome 组
      if (url.protocol === 'chrome:') {
        domain = 'chrome';
      } else {
        domain = url.hostname;
      }
      
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
    if (tab.url === 'chrome://newtab/' || !tab.favIconUrl) {
      faviconHtml = `
        <svg class="tab-favicon" viewBox="0 0 1024 1024">
          <path d="M258.016 447.008L112 192.992Q183.008 102.976 288 51.488T512 0q138.016 0 255.488 68t185.504 183.008H534.976q-11.008-0.992-23.008-0.992-90.016 0-160.992 55.488t-92.992 141.504z m436.992-122.016h294.016q35.008 90.016 35.008 187.008 0 103.008-40 197.504t-107.488 163.008-161.504 109.504-196.992 42.016l208.992-363.008q47.008-67.008 47.008-148.992 0-110.016-79.008-187.008zM326.016 512q0-76.992 54.496-131.488T512 326.016t131.488 54.496T697.984 512t-54.496 131.488T512 697.984t-131.488-54.496T326.016 512z m256 252.992l-146.016 252.992q-122.016-18.016-222.016-88.992t-156.992-180.992T0 512q0-135.008 66.016-251.008l208.992 362.016q32 68 96 109.504T512 774.016q36 0 70.016-8.992z" fill="#5f6368"/>
        </svg>`;
    } else {
      faviconHtml = `<img class="tab-favicon" src="${tab.favIconUrl}" alt="" onerror="this.style.display='none'">`;
    }
    
    // 修改 HTML 结构，确保标签按钮在正确的位置
    tabItem.innerHTML = `
      <div class="checkbox"></div>
      ${faviconHtml}
      <span class="tab-title" title="${tab.title}">${newTitle}</span>
      <div class="tab-actions">
        <button class="tag-button" title="设置标签"></button>
        ${tagDropdownHtml}
        <button class="pin-button" title="置顶标签页">
          <svg viewBox="0 0 24 24">
            <path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z" />
          </svg>
        </button>
        <button class="close-button" title="关闭标签页">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 6l12 12M6 18L18 6"/>
          </svg>
        </button>
      </div>
    `;
    
    // 添加双击标题关闭标签页功能
    const titleElement = tabItem.querySelector('.tab-title');
    titleElement.addEventListener('dblclick', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // 获取设置并检查是否启用双击关闭
      const { settings } = await chrome.storage.local.get('settings');
      if (settings?.doubleClickToClose) {
        await chrome.tabs.remove(tab.id);
        tabItem.remove();
      }
    });
    
    // 添加标签按钮点击事件
    const tagButton = tabItem.querySelector('.tag-button');
    const tagDropdown = tabItem.querySelector('.tag-dropdown');
    
    tagButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // 关闭其他所有下拉菜单
      document.querySelectorAll('.tag-dropdown.show').forEach(dropdown => {
        if (dropdown !== tagDropdown) {
          dropdown.classList.remove('show');
        }
      });
      
      // 切换当前下拉菜单
      const isVisible = tagDropdown.classList.contains('show');
      if (!isVisible) {
        // 确保在显示之前其他所有下拉菜单都已关闭
        document.querySelectorAll('.tag-dropdown.show').forEach(dropdown => {
          dropdown.classList.remove('show');
        });
      }
      tagDropdown.classList.toggle('show');
    });
    
    // 颜色选择事件
    const tagColors = tabItem.querySelectorAll('.tag-color');
    tagColors.forEach(color => {
      color.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const selectedColor = color.dataset.color;
        
        // 保存标签颜色到存储
        chrome.storage.local.get(['tabTags'], (result) => {
          const tabTags = result.tabTags || {};
          tabTags[tab.id] = selectedColor;
          chrome.storage.local.set({ tabTags }, () => {
            // 保存颜色保存后立即应用
            tabItem.dataset.tagColor = selectedColor;
            
            // 立即更新颜色筛选器
            createColorFilter(tabTags);
          });
        });
        
        // 关闭颜色选择器
        tagDropdown.classList.remove('show');
      });
    });
    
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
    
    // 初始化拖拽功能
    initDragAndDrop(tabItem);
    
    tabList.appendChild(tabItem);
  });
  
  container.appendChild(tabList);
  console.log('渲染完成');
  
  // 获取当前标签颜色
  chrome.storage.local.get(['tabTags'], (result) => {
    const tabTags = result.tabTags || {};
    createColorFilter(tabTags);
  });
}

/**
 * 初始化拖拽功能
 * @param {HTMLElement} tabItem - 标签页元素
 */
function initDragAndDrop(tabItem) {
  tabItem.setAttribute('draggable', 'true');
  
  tabItem.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', e.target.getAttribute('data-tab-id'));
    e.target.classList.add('dragging');
  });
  
  tabItem.addEventListener('dragend', (e) => {
    e.target.classList.remove('dragging');
  });
  
  tabItem.addEventListener('dragover', (e) => {
    e.preventDefault();
    const draggingItem = document.querySelector('.dragging');
    if (!draggingItem) return;
    
    const afterElement = getDragAfterElement(tabItem.parentElement, e.clientY);
    if (afterElement) {
      afterElement.parentElement.insertBefore(draggingItem, afterElement);
    } else {
      tabItem.parentElement.appendChild(draggingItem);
    }
  });
  
  tabItem.addEventListener('drop', (e) => {
    e.preventDefault();
    const draggedTabId = parseInt(e.dataTransfer.getData('text/plain'));
    const targetTabId = parseInt(tabItem.getAttribute('data-tab-id'));
    
    if (draggedTabId === targetTabId) return;
    
    // 更新标签页顺序
    updateTabOrder(draggedTabId, targetTabId);
  });
}

/**
 * 获取拖拽后的目标元素
 * @param {HTMLElement} container - 容器元素
 * @param {number} y - 鼠标Y坐标
 * @returns {HTMLElement|null} 目标元素
 */
function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.tab-item:not(.dragging)')];
  
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

/**
 * 更新标签页顺序
 * @param {number} draggedTabId - 被拖拽的标签页ID
 * @param {number} targetTabId - 目标标签页ID
 */
async function updateTabOrder(draggedTabId, targetTabId) {
  try {
    const tabs = await getCurrentTabs();
    const draggedTab = tabs.find(tab => tab.id === draggedTabId);
    const targetTab = tabs.find(tab => tab.id === targetTabId);
    
    if (!draggedTab || !targetTab) return;
    
    // 移动标签页
    await chrome.tabs.move(draggedTabId, { index: targetTab.index });
    
    // 重新渲染标签页列表
    const updatedTabs = await getCurrentTabs();
    const container = document.getElementById('tabGroups');
    const isGroupView = container.querySelector('.tab-group') !== null;
    
    if (isGroupView) {
      const groups = groupTabs(updatedTabs);
      renderGroups(groups);
    } else {
      renderDefaultView(updatedTabs);
    }
  } catch (error) {
    console.error('更新标签页顺序失败:', error);
  }
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
      
      // 等待页面加载
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 如果正在从归档视图中恢复标签页，不执行任何操作
      if (isRestoringFromArchive || isShowingArchived) {
        return;
      }
      
      // 获取当前视图模式
      const defaultButton = document.getElementById('defaultView');
      const aiButton = document.getElementById('aiGroupTabs');
      
      // 获取当前激活的视图按钮
      let currentView = 'default';
      if (aiButton && aiButton.classList.contains('active')) {
        currentView = 'ai';
      }
      
      // 获取最新的标签页
      const tabs = await getCurrentTabs();
      
      // 在 AI 分组视图下处理新标签页
      if (currentView === 'ai') {
        // 获取新标签页信息
        const newTab = tabs.find(tab => tab.id === message.tabId);
        if (newTab) {
          // 如果没有缓存的分组结果，创建一个新的
          if (!lastAiGroupResult) {
            lastAiGroupResult = {
              '未分类': []
            };
          }
          
          // 确保未分类组存在
          if (!lastAiGroupResult['未分类']) {
            lastAiGroupResult['未分类'] = [];
          }
          
          // 检查新标签页是否已经在未分类组中
          const isTabExists = lastAiGroupResult['未分类'].some(item => item.tab.id === newTab.id);
          
          if (!isTabExists) {
            // 添加新标签页到未分类组
            lastAiGroupResult['未分类'].push({
              tab: newTab,
              newTitle: newTab.title || 'New Tab'
            });
            
            // 增加新标签页计数
            newTabsCount++;
            console.log(`新增标签页数量: ${newTabsCount}`);
            
            // 立即渲染更新后的分组
            renderGroups(lastAiGroupResult);
            
            // 检查是否需要触发自动重新分组
            if (newTabsCount >= AUTO_REGROUP_THRESHOLD) {
              console.log('触发自动重新分组');
              newTabsCount = 0; // 重置计数器
              lastAiGroupResult = null; // 清除缓存
              lastAiGroupTime = 0;
              await aiGroupTabs(tabs); // 重新分组
            }
          }
        }
      } else {
        // 默认视图下直接渲染
        renderDefaultView(tabs);
      }
      
      // 恢复所有标签颜色
      const result = await chrome.storage.local.get(['tabTags']);
      const tabTags = result.tabTags || {};
      Object.entries(tabTags).forEach(([tabId, color]) => {
        const tabItem = document.querySelector(`.tab-item[data-tab-id="${tabId}"]`);
        if (tabItem) {
          tabItem.dataset.tagColor = color;
        }
      });
    }
  } catch (error) {
    console.error('popup：处理后台消息失败', error);
    // 出错时切换到默认视图
    switchView('default');
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
    modelType: 'gemini',
    apiKey: '',
    doubleClickToClose: true
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
  const modelTypeSelect = document.getElementById('modelType');
  const apiKeyInput = document.getElementById('apiKey');
  const doubleClickToCloseSelect = document.getElementById('doubleClickToClose');
  
  if (themeModeSelect) {
    themeModeSelect.value = settings.themeMode;
  }
  
  if (defaultViewSelect) {
    defaultViewSelect.value = settings.defaultView;
  }
  
  if (modelTypeSelect) {
    modelTypeSelect.value = settings.modelType;
  }
  
  if (apiKeyInput) {
    apiKeyInput.value = settings.apiKey || '';
  }
  
  if (doubleClickToCloseSelect) {
    doubleClickToCloseSelect.value = settings.doubleClickToClose ? 'true' : 'false';
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
 * @param {string} mode - 视图模式：'default'|'ai'
 */
async function switchView(mode) {
  try {
    // 显示颜色标签选择器
    const colorFilterContainer = document.querySelector('.color-filter-container');
    if (colorFilterContainer) {
      colorFilterContainer.style.display = '';
    }
    
    // 获取存储的标签颜色
    const result = await chrome.storage.local.get(['tabTags', 'settings']);
    const tabTags = result.tabTags || {};
    const settings = result.settings || getDefaultSettings();
    
    // 更新按钮样式
    const defaultButton = document.getElementById('defaultView');
    const aiButton = document.getElementById('aiGroupTabs');
    
    // 只有在按钮存在时才更新其状态
    if (defaultButton) {
      defaultButton.classList.remove('active');
    }
    if (aiButton) {
      aiButton.classList.remove('active');
    }
    
    // 获取当前标签页
    const tabs = await getCurrentTabs();
    
    // 根据模式添加active类并渲染视图
    try {
      if (mode === 'default') {
        if (defaultButton) {
          defaultButton.classList.add('active');
        }
        renderDefaultView(tabs);
        
        // 保存当前视图模式到设置
        settings.defaultView = 'default';
        await chrome.storage.local.set({ settings });
      } else if (mode === 'ai' && tabs.length > 0) {
        if (aiButton) {
          aiButton.classList.add('active');
        }
        
        // 如果有缓存的AI分组结果且未过期，直接使用缓存
        const currentTime = Date.now();
        if (lastAiGroupResult && 
            lastAiGroupTime && 
            (currentTime - lastAiGroupTime < AI_CACHE_TIMEOUT)) {
          renderGroups(lastAiGroupResult);
        } else {
          await aiGroupTabs(tabs);
        }
        
        // 保存当前视图模式到设置
        settings.defaultView = 'ai';
        await chrome.storage.local.set({ settings });
      } else {
        // 如果没有标签页或模式无效，切换到默认视图
        if (defaultButton) {
          defaultButton.classList.add('active');
        }
        renderDefaultView(tabs);
        
        // 保存当前视图模式到设置
        settings.defaultView = 'default';
        await chrome.storage.local.set({ settings });
      }
      
      // 恢复所有标签颜色
      Object.entries(tabTags).forEach(([tabId, color]) => {
        const tabItem = document.querySelector(`.tab-item[data-tab-id="${tabId}"]`);
        if (tabItem) {
          tabItem.dataset.tagColor = color;
        }
      });
      
      // 更新计数
      updateTabCount();
    } catch (error) {
      console.error('视图切换失败:', error);
      // 出错时切换到默认视图
      if (defaultButton) {
        defaultButton.classList.add('active');
      }
      renderDefaultView(tabs);
      
      // 保存当前视图模式到设置
      settings.defaultView = 'default';
      await chrome.storage.local.set({ settings });
    }
  } catch (error) {
    console.error('切换视图失败:', error);
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
      document.getElementById('apiKey').value = settings.apiKey || '';
    }
  }
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
      alert('先选择要分享的标签页！');
    }
  } catch (error) {
    console.error('复制失败:', error);
    alert('复制失败，请重试');
  }
}

// 修改全局点击事件处理
document.addEventListener('click', (e) => {
  const tagButton = e.target.closest('.tag-button');
  const tagDropdown = e.target.closest('.tag-dropdown');
  
  if (!tagButton && !tagDropdown) {
    // 如果点击的既不是标签按钮也不是下拉菜单，则关闭所有下拉菜单
    document.querySelectorAll('.tag-dropdown.show').forEach(dropdown => {
      dropdown.classList.remove('show');
    });
  }
});

// 阻止颜色选择器内的点击事件冒泡
document.querySelectorAll('.tag-dropdown').forEach(dropdown => {
  dropdown.addEventListener('click', (e) => {
    e.stopPropagation();
  });
});

// 在文件顶部添加标签页创建事件监听
chrome.tabs.onCreated.addListener(async (tab) => {
  // 等待一小段时间确保标签页完全创建
  await new Promise(resolve => setTimeout(resolve, 200));
  
  try {
    // 如果正在从归档视图中恢复标签页，不执行任何操作
    if (isRestoringFromArchive || isShowingArchived) {
      return;
    }

    // 获取当前视图模式
    const defaultButton = document.getElementById('defaultView');
    const groupButton = document.getElementById('groupTabs');
    const aiButton = document.getElementById('aiGroupTabs');
    
    // 获取当前激活的视图按钮
    let currentView = 'default';
    if (groupButton.classList.contains('active')) {
      currentView = 'domain';
    } else if (aiButton.classList.contains('active')) {
      currentView = 'ai';
    }

    // 获取存储的标签颜色
    const result = await chrome.storage.local.get(['tabTags']);
    const tabTags = result.tabTags || {};
    
    // 获取所有标签页
    const tabs = await getCurrentTabs();
    
    // 获取容器
    const tabsContainer = document.getElementById('tabGroups');
    if (!tabsContainer) {
      return;
    }
    
    // 使用 switchView 函数来保持当前视图状态
    await switchView(currentView);
    
    // 恢复所有标签颜色
    Object.entries(tabTags).forEach(([tabId, color]) => {
      const tabItem = document.querySelector(`.tab-item[data-tab-id="${tabId}"]`);
      if (tabItem) {
        tabItem.dataset.tagColor = color;
      }
    });
  } catch (error) {
    console.error('处理新标签页创建失败:', error);
  }
});

// 添加创建颜色筛选器的函数
function createColorFilter(tabTags) {
  const filterContainer = document.querySelector('.color-filter-container');
  
  if (!filterContainer) {
    console.error('未找到颜色筛选器容器');
    return;
  }
  
  // 清空容器
  filterContainer.innerHTML = '';
  
  // 创建一个包装器来包含颜色筛选器和 clear 按钮
  const wrapper = document.createElement('div');
  wrapper.className = 'filter-wrapper';
  wrapper.style.display = 'flex';
  wrapper.style.justifyContent = 'space-between';
  wrapper.style.alignItems = 'center';
  wrapper.style.width = '100%';
  
  // 获取当前所有标签页的ID
  const currentTabIds = Array.from(document.querySelectorAll('.tab-item'))
    .map(item => parseInt(item.getAttribute('data-tab-id')))
    .filter(id => !isNaN(id));
  
  // 获取所有使用的颜色及其对应的标签页数量，只统计当前存在的标签页
  const colorCounts = {};
  Object.entries(tabTags).forEach(([tabId, color]) => {
    if (color && currentTabIds.includes(parseInt(tabId))) {
      colorCounts[color] = (colorCounts[color] || 0) + 1;
    }
  });
  
  // 创建颜色筛选器容器
  const filterWrapper = document.createElement('div');
  filterWrapper.className = 'color-filter';
  
  // 如果有使用的颜色，显示颜色筛选器
  const hasColoredTabs = Object.keys(colorCounts).length > 0;
  if (hasColoredTabs) {
    Object.entries(colorCounts).forEach(([color, count]) => {
      const colorButton = document.createElement('button');
      colorButton.className = `color-filter-button ${color}`;
      if (color === currentSelectedColor) {
        colorButton.classList.add('active');
      }
      colorButton.title = `筛选${color}标签 (${count})`;
      
      colorButton.addEventListener('click', () => {
        // 切换选中状态
        if (currentSelectedColor === color) {
          currentSelectedColor = null;
          colorButton.classList.remove('active');
        } else {
          // 移除其他按钮的active类
          filterWrapper.querySelectorAll('.color-filter-button').forEach(btn => {
            btn.classList.remove('active');
          });
          currentSelectedColor = color;
          colorButton.classList.add('active');
        }
        
        // 应用筛选
        document.querySelectorAll('.tab-item').forEach(item => {
          if (!currentSelectedColor || item.dataset.tagColor === currentSelectedColor) {
            item.style.display = '';
          } else {
            item.style.display = 'none';
          }
        });
        
        // 更新计数
        updateTabCount();
      });
      
      filterWrapper.appendChild(colorButton);
    });
  }
  
  // 创建 clear 按钮
  const clearButton = document.createElement('button');
  clearButton.className = 'clear-button';
  clearButton.innerHTML = 'clear (<span class="tab-count">0</span>)';
  
  clearButton.addEventListener('click', async () => {
    try {
      // 获取当前显示的标签页
      const visibleTabs = Array.from(document.querySelectorAll('.tab-item')).filter(
        item => getComputedStyle(item).display !== 'none'
      );
      
      // 获取要关闭的标签页ID
      const tabIds = visibleTabs.map(item => parseInt(item.getAttribute('data-tab-id'))).filter(id => !isNaN(id));
      
      if (tabIds.length > 0) {
        // 检查是否是全部标签页（没有筛选）
        const isAllTabs = !currentSelectedColor && !currentSelectedDomain && 
                         !document.getElementById('searchInput')?.value;
        
        if (isAllTabs) {
          // 如果是全部标签页，先创建一个新标签页
          await chrome.tabs.create({});
        }

        // 关闭标签页
        await chrome.tabs.remove(tabIds);
        
        // 获取当前的标签颜色数据
        const { tabTags } = await chrome.storage.local.get(['tabTags']);
        
        // 如果是通过颜色筛选，只删除当前颜色的标签记录
        if (currentSelectedColor) {
          tabIds.forEach(id => {
            if (tabTags[id] === currentSelectedColor) {
              delete tabTags[id];
            }
          });
        } else {
          // 如果不是通过颜色筛选，删除所有关闭标签页的颜色记录
          tabIds.forEach(id => {
            delete tabTags[id];
          });
        }
        
        // 保存更新后的标签颜色数据
        await chrome.storage.local.set({ tabTags });
        
        // 重置所有筛选条件
        // 1. 重置颜色筛选
        currentSelectedColor = null;
        document.querySelectorAll('.color-filter-button').forEach(btn => {
          btn.classList.remove('active');
        });
        
        // 2. 重置域名筛选
        currentSelectedDomain = null;
        document.querySelectorAll('.favicon-item').forEach(item => {
          item.classList.remove('active');
        });
        
        // 3. 清空搜索框
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
          searchInput.value = '';
        }
        
        // 重新加载标签页列表
        const remainingTabs = await getCurrentTabs();
        const isGroupView = document.querySelector('.tab-group') !== null;
        if (isGroupView) {
          renderGroups(groupTabs(remainingTabs));
        } else {
          renderDefaultView(remainingTabs);
        }
        
        // 恢复所有标签颜色
        Object.entries(tabTags).forEach(([tabId, color]) => {
          const tabItem = document.querySelector(`.tab-item[data-tab-id="${tabId}"]`);
          if (tabItem) {
            tabItem.dataset.tagColor = color;
          }
        });
        
        // 更新颜色筛选器
        createColorFilter(tabTags);
      }
    } catch (error) {
      console.error('关闭标签页失败:', error);
    }
  });
  
  // 将颜色筛选器和 clear 按钮添加到包装器中
  wrapper.appendChild(filterWrapper);
  wrapper.appendChild(clearButton);
  
  // 将包装器添加到容器中
  filterContainer.appendChild(wrapper);
  filterContainer.style.display = '';
}

/**
 * 创建顶部栏
 * @returns {HTMLElement} 顶部栏元素
 */
function createHeader() {
  const header = document.createElement('div');
  header.className = 'tabs-header';
  
  // 在分享模式下添加全选功能
  if (isShareMode) {
    const selectAllWrapper = document.createElement('div');
    selectAllWrapper.className = 'select-all-wrapper';
    
    // 创建复选框容器
    const checkboxWrapper = document.createElement('div');
    checkboxWrapper.className = 'checkbox-wrapper';
    
    // 创建复选框
    const checkbox = document.createElement('div');
    checkbox.className = 'checkbox';
    if (selectedTabs.size > 0) {
      checkbox.classList.add('selected');
    }
    
    // 创建标签文本
    const label = document.createElement('span');
    label.className = 'select-all-label';
    label.textContent = '全选';
    
    // 添加点击事件
    selectAllWrapper.addEventListener('click', () => {
      const isAllSelected = selectedTabs.size === document.querySelectorAll('.tab-item').length;
      
      if (isAllSelected) {
        // 取消全选
        selectedTabs.clear();
        document.querySelectorAll('.tab-item').forEach(item => {
          item.classList.remove('selected');
        });
        checkbox.classList.remove('selected');
      } else {
        // 全选
        document.querySelectorAll('.tab-item').forEach(item => {
          const tabId = parseInt(item.getAttribute('data-tab-id'));
          selectedTabs.add(tabId);
          item.classList.add('selected');
        });
        checkbox.classList.add('selected');
      }
      
      // 更新选中计数
      updateSelectedCount();
    });
    
    // 组装元素
    checkboxWrapper.appendChild(checkbox);
    selectAllWrapper.appendChild(checkboxWrapper);
    selectAllWrapper.appendChild(label);
    header.appendChild(selectAllWrapper);
  }
  
  return header;
}

// 添加一个函数来更新音频按钮状态
async function updateAudioButton() {
  const audioButton = document.getElementById('audioButton');
  const tabs = await chrome.tabs.query({ audible: true });
  
  if (tabs.length > 0) {
    audioButton.classList.add('active');
    audioButton.title = `正在播放 (${tabs.length})`;
  } else {
    audioButton.classList.remove('active');
    audioButton.title = '正在播放';
  }
}

// 在标签页更新时更新按钮状态
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.audible !== undefined) {
    updateAudioButton();
  }
});

// 添加一个变量来跟踪音频筛选状态
let isAudioFilterActive = false;

// 在标签页更新时更新筛选状态
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.audible !== undefined && isAudioFilterActive) {
    // 重新应用筛选
    document.getElementById('audioButton').click();
    document.getElementById('audioButton').click();
  }
});

// 确保在DOM加载完成后绑定搜索事件
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', handleSearch);
    console.log('搜索事件监听器已绑定');
  } else {
    console.error('未找到搜索输入框');
  }
});

/**
 * 更新标签页计数
 */
function updateTabCount() {
  try {
    // 使用 getComputedStyle 来检查元素是否可见，这样更高效
    const tabItems = document.querySelectorAll('.tab-item');
    let visibleCount = 0;
    
    tabItems.forEach(item => {
      if (getComputedStyle(item).display !== 'none') {
        visibleCount++;
      }
    });
    
    const countSpan = document.querySelector('.tab-count');
    if (countSpan && countSpan.textContent !== visibleCount.toString()) {
      countSpan.textContent = visibleCount;
    }
  } catch (error) {
    console.error('更新标签页计数失败:', error);
  }
}

// 使用 requestAnimationFrame 来优化更新频率
function startTabCountUpdater() {
  let frameId;
  let lastUpdate = 0;
  const UPDATE_INTERVAL = 300; // 更新间隔改为300毫秒

  function update(timestamp) {
    if (timestamp - lastUpdate >= UPDATE_INTERVAL) {
      updateTabCount();
      lastUpdate = timestamp;
    }
    frameId = requestAnimationFrame(update);
  }

  frameId = requestAnimationFrame(update);

  // 返回一个清理函数
  return () => {
    if (frameId) {
      cancelAnimationFrame(frameId);
    }
  };
}

// 在文档加载完成后启动更新器
document.addEventListener('DOMContentLoaded', () => {
  startTabCountUpdater();
});



// 修改重置筛选器函数
async function resetAllFilters() {
  // 重置图标筛选
  currentSelectedDomain = null;
  const activeFaviconItem = document.querySelector('.favicon-item.active');
  if (activeFaviconItem) {
    activeFaviconItem.classList.remove('active');
  }
  
  // 重置搜索框
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.value = '';
  }
  
  // 重置其他可能的筛选状态
  isShowingArchived = false;
  const archiveListButton = document.getElementById('archiveListButton');
  if (archiveListButton) {
    archiveListButton.classList.remove('active');
  }

  // 先获取最新的标签页列表
  const tabs = await getCurrentTabs();
  
  // 重新初始化图标索引
  const tempGroups = {};
  tabs.forEach(tab => {
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
  
  // 清空当前列表
  const tabsContainer = document.getElementById('tabGroups');
  if (tabsContainer) {
    tabsContainer.innerHTML = '';
  }
  
  // 创建新的图标索引
  createFaviconIndex(tempGroups);

  // 渲染最新的标签页列表
  if (isGroupView) {
    renderGroups(groupTabs(tabs));
  } else {
    renderDefaultView(tabs);
  }
}

// 添加显示所有标签页的函数
function showAllTabs() {
  // 移除所有标签页的 hidden 类
  document.querySelectorAll('.tab-item').forEach(tab => {
    tab.classList.remove('hidden');
    tab.style.display = '';
  });
  
  // 移除所有分组的 hidden 类
  document.querySelectorAll('.tab-group').forEach(group => {
    group.classList.remove('hidden');
    group.style.display = '';
  });
  
  // 如果在分组视图中，确保所有分组都可见
  if (isGroupView) {
    document.querySelectorAll('.group-header').forEach(header => {
      header.style.display = '';
    });
  }
}

// 修改归档函数
async function archiveCurrentTabs() {
  const tabIds = getSelectedTabIds();
  if (tabIds.length === 0) return;

  const currentTabs = await chrome.tabs.query({ currentWindow: true });
  const tabsToArchive = currentTabs.filter(tab => tabIds.includes(tab.id));
  
  // 获取当前时间作为归档组名
  const now = new Date();
  const groupName = `归档于 ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
  
  // 准备归档数据
  const archivedTabs = tabsToArchive.map(tab => ({
    title: tab.title,
    url: tab.url,
    favIconUrl: tab.favIconUrl,
    timestamp: now.getTime()
  }));

  // 获取现有归档数据
  const { archivedGroups = [] } = await chrome.storage.local.get('archivedGroups');
  
  // 添加新的归档组
  archivedGroups.unshift({
    name: groupName,
    tabs: archivedTabs,
    timestamp: now.getTime()
  });

  // 保存更新后的归档数据
  await chrome.storage.local.set({ archivedGroups });

  // 如果要归档的是所有标签页,先创建一个新标签页
  if (tabIds.length === currentTabs.length) {
    await chrome.tabs.create({});
  }

  // 关闭已归档的标签页
  await chrome.tabs.remove(tabIds);

  // 获取最新的标签页列表
  const tabs = await getCurrentTabs();
  
  // 直接渲染默认视图
  renderDefaultView(tabs);
}

// 修改标签页列表更新函数
async function updateTabList() {
  const tabs = await getCurrentTabs();
  const { archivedGroups = [] } = await chrome.storage.local.get('archivedGroups');
  
  // 获取归档按钮状态
  const archiveListButton = document.getElementById('archiveListButton');
  const isInArchivedView = archiveListButton && archiveListButton.classList.contains('active');
  
  if (isInArchivedView) {
    // 仅显示归档标签页
    renderArchivedView(archivedGroups);
    
    // 确保其他视图按钮处于非激活状态
    document.getElementById('defaultView')?.classList.remove('active');
    document.getElementById('groupTabs')?.classList.remove('active');
    document.getElementById('aiGroupTabs')?.classList.remove('active');
    
    // 确保归档按钮保持激活状态
    archiveListButton.classList.add('active');
  } else if (isGroupView) {
    // 在分组视图中只显示普通标签页
    const groups = groupTabs(tabs);
    renderGroups(groups);
  } else {
    // 在默认视图中只显示普通标签页
    renderDefaultView(tabs);
  }
}



// 渲染归档视图
function renderArchivedView(archivedGroups) {
  const container = document.getElementById('tabGroups');
  container.innerHTML = '';
  
  // 隐藏颜色标签选择器和 clear 按钮
  const colorFilterContainer = document.querySelector('.color-filter-container');
  if (colorFilterContainer) {
    colorFilterContainer.style.display = 'none';
  }
  
  if (archivedGroups.length === 0) {
    container.innerHTML = '<div class="empty-message">没有已归档的标签页</div>';
    return;
  }

  archivedGroups.forEach(group => {
    const groupElement = createGroupElement(group.name, group.tabs, true);
    container.appendChild(groupElement);
  });
}

// 修改创建分组元素的函数
function createGroupElement(groupName, tabs, isArchived = false) {
  const groupDiv = document.createElement('div');
  groupDiv.className = `tab-group ${isArchived ? 'archived-group' : ''}`;
  
  const groupHeader = document.createElement('div');
  groupHeader.className = 'group-header';
  groupHeader.innerHTML = `
    <div class="group-header-content">
      <span class="group-toggle">
        <svg class="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </span>
      <span class="group-title">${groupName}</span>
      <span class="tab-count">${tabs.length}</span>
    </div>
    ${isArchived ? `
      <button class="restore-group-button" title="恢复分组">
        <svg viewBox="0 0 24 24" width="16" height="16">
          <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z" fill="currentColor"/>
        </svg>
      </button>
    ` : ''}
  `;
  
  const tabList = document.createElement('div');
  tabList.className = 'tab-list';
  
  tabs.forEach(tab => {
    const tabElement = createTabElement(tab, isArchived);
    tabList.appendChild(tabElement);
  });
  
  // 添加分组标题点击事件
  const headerContent = groupHeader.querySelector('.group-header-content');
  headerContent.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const chevron = headerContent.querySelector('.chevron-icon');
    
    if (tabList.style.display === 'none') {
      // 展开
      tabList.style.display = '';
      chevron.style.transform = 'rotate(0deg)';
      groupDiv.classList.remove('collapsed');
    } else {
      // 收起
      tabList.style.display = 'none';
      chevron.style.transform = 'rotate(-90deg)';
      groupDiv.classList.add('collapsed');
    }
  });

  // 添加恢复分组按钮点击事件
  if (isArchived) {
    const restoreGroupButton = groupHeader.querySelector('.restore-group-button');
    if (restoreGroupButton) {
      restoreGroupButton.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        try {
          // 设置标志，表示正在从归档视图中恢复标签页
          isRestoringFromArchive = true;
          isShowingArchived = true;
          
          // 为分组中的每个标签页创建新标签页
          for (const tab of tabs) {
            await chrome.tabs.create({ url: tab.url });
          }
          
          // 获取最新的归档数据
          const { archivedGroups = [] } = await chrome.storage.local.get('archivedGroups');
          
          // 从归档数据中移除已恢复的分组
          const updatedGroups = archivedGroups.filter(group => group.name !== groupName);
          await chrome.storage.local.set({ archivedGroups: updatedGroups });
          
          // 确保归档按钮保持激活状态
          const archiveListButton = document.getElementById('archiveListButton');
          if (archiveListButton) {
            archiveListButton.classList.add('active');
          }
          
          // 移除其他视图的激活状态
          document.getElementById('defaultView')?.classList.remove('active');
          document.getElementById('groupTabs')?.classList.remove('active');
          document.getElementById('aiGroupTabs')?.classList.remove('active');
          
          // 立即渲染归档视图
          renderArchivedView(updatedGroups);
          
          // 延迟重置标志
          setTimeout(() => {
            isRestoringFromArchive = false;
          }, 5000); // 增加延迟时间到5秒
        } catch (error) {
          console.error('恢复分组失败:', error);
          // 确保在出错时也重置标志
          isRestoringFromArchive = false;
        }
      });
    }
  }
  
  groupDiv.appendChild(groupHeader);
  groupDiv.appendChild(tabList);
  return groupDiv;
}


let isShowingArchived = false;

// 在文档加载完成后初始化事件监听器
document.addEventListener('DOMContentLoaded', () => {
  // 归档按钮点击事件
  document.getElementById('archiveButton').addEventListener('click', archiveCurrentTabs);
  
  // 已归档按钮点击事件
  document.getElementById('archiveListButton').addEventListener('click', async () => {
    isShowingArchived = !isShowingArchived;
    const button = document.getElementById('archiveListButton');
    button.classList.toggle('active', isShowingArchived);
    
    if (isShowingArchived) {
      // 显示归档列表
      const { archivedGroups = [] } = await chrome.storage.local.get('archivedGroups');
      renderArchivedView(archivedGroups);
      
      // 移除其他视图的激活状态
      document.getElementById('defaultView')?.classList.remove('active');
      document.getElementById('aiGroupTabs')?.classList.remove('active');
    } else {
      // 获取当前标签页并切换回默认视图
      const tabs = await getCurrentTabs();
      renderDefaultView(tabs);
      
      // 激活默认视图按钮
      const defaultButton = document.getElementById('defaultView');
      if (defaultButton) {
        defaultButton.classList.add('active');
      }
      
      // 移除其他视图的激活状态
      document.getElementById('aiGroupTabs')?.classList.remove('active');
      
      // 显示颜色标签选择器
      const colorFilterContainer = document.querySelector('.color-filter-container');
      if (colorFilterContainer) {
        colorFilterContainer.style.display = '';
      }
      
      // 恢复标签颜色
      const { tabTags = {} } = await chrome.storage.local.get('tabTags');
      Object.entries(tabTags).forEach(([tabId, color]) => {
        const tabItem = document.querySelector(`.tab-item[data-tab-id="${tabId}"]`);
        if (tabItem) {
          tabItem.dataset.tagColor = color;
        }
      });
      
      // 更新颜色筛选器
      createColorFilter(tabTags);
    }
  });
});

// 获取选中的标签页ID
function getSelectedTabIds() {
  const visibleTabs = Array.from(document.querySelectorAll('.tab-item')).filter(
    item => getComputedStyle(item).display !== 'none'
  );
  
  if (visibleTabs.length === 0) {
    alert('没有可归档的标签页');
    return [];
  }
  
  return visibleTabs
    .map(item => parseInt(item.getAttribute('data-tab-id')))
    .filter(id => !isNaN(id));
}

// 在文件顶部添加变量
let isRestoringFromArchive = false;

/**
 * 恢复归档标签页
 * @param {ArchivedTab} archivedTab - 归档的标签页
 */
async function restoreArchivedTab(archivedTab) {
  try {
    isRestoringFromArchive = true;
    
    // 创建新标签页
    const tab = await chrome.tabs.create({
      url: archivedTab.url,
      active: false
    });
    
    // 从存储中移除已恢复的标签页
    const result = await chrome.storage.local.get(['archivedTabs']);
    const archivedTabs = result.archivedTabs || [];
    const updatedArchivedTabs = archivedTabs.filter(t => t.url !== archivedTab.url);
    await chrome.storage.local.set({ archivedTabs: updatedArchivedTabs });
    
    // 重新渲染归档列表
    renderArchivedView();
    
    // 重置标志变量
    isRestoringFromArchive = false;
    isShowingArchived = false;
    
    // 获取当前视图模式
    const defaultButton = document.getElementById('defaultView');
    const groupButton = document.getElementById('groupTabs');
    const aiButton = document.getElementById('aiGroupTabs');
    
    // 获取当前激活的视图按钮
    let currentView = 'default';
    if (groupButton.classList.contains('active')) {
      currentView = 'domain';
    } else if (aiButton.classList.contains('active')) {
      currentView = 'ai';
    }
    
    // 获取最新的标签页列表并按当前视图模式渲染
    const tabs = await getCurrentTabs();
    
    // 使用 switchView 函数来保持当前视图状态
    await switchView(currentView);
    
  } catch (error) {
    console.error('恢复归档标签页失败:', error);
    // 确保在出错时也重置标志
    isRestoringFromArchive = false;
    isShowingArchived = false;
  }
}

/**
 * 恢复最近关闭的标签页
 */
async function restoreClosedTab() {
  try {
    // 使用 chrome.sessions API 获取最近关闭的会话
    chrome.sessions.getRecentlyClosed({ maxResults: 1 }, function(sessions) {
      if (sessions.length === 0) {
        console.log('没有可恢复的标签页');
        return;
      }

      const session = sessions[0];
      if (session.tab) {
        // 恢复标签页
        chrome.sessions.restore(session.tab.sessionId, function(restoredSession) {
          if (restoredSession?.tab?.id) {
            // 将标签页移动到末尾并激活
            chrome.tabs.move(restoredSession.tab.id, { index: -1 }, function() {
              chrome.tabs.update(restoredSession.tab.id, { active: true });
            });
          }
        });
      } else if (session.window) {
        // 恢复窗口
        chrome.sessions.restore(session.window.sessionId);
      }
    });

    // 获取当前视图模式
    const defaultButton = document.getElementById('defaultView');
    const groupButton = document.getElementById('groupTabs');
    const aiButton = document.getElementById('aiGroupTabs');
    
    // 获取当前激活的视图按钮
    let currentView = 'default';
    if (groupButton.classList.contains('active')) {
      currentView = 'domain';
    } else if (aiButton.classList.contains('active')) {
      currentView = 'ai';
    }
    
    // 使用 switchView 函数来保持当前视图状态
    await switchView(currentView);

  } catch (error) {
    console.error('恢复标签页失败:', error);
  }
}

// 在DOMContentLoaded事件监听器中添加
document.addEventListener('DOMContentLoaded', async () => {
  // ... existing code ...
  
  // 从storage加载closedTabs
  const result = await chrome.storage.local.get(['closedTabs']);
  closedTabs = result.closedTabs || [];
  
  // 恢复按钮点击事件
  document.getElementById('restoreButton').addEventListener('click', restoreClosedTab);
});

// 添加颜色映射
const GROUP_COLORS = {
  grey: '#5f6368',   // Chrome的灰色
  blue: '#1a73e8',   // Chrome的蓝色
  red: '#ea4335',    // Chrome的红色
  yellow: '#fbbc04', // Chrome的黄色
  green: '#34a853',  // Chrome的绿色
  pink: '#e8608a',   // Chrome的粉色
  purple: '#a142f4', // Chrome的紫色
  cyan: '#24c1e0'    // Chrome的青色
};

/**
 * 更新AI分组缓存
 * @param {number} closedTabId - 被关闭的标签页ID
 */
function updateAiGroupCache(closedTabId) {
  if (lastAiGroupResult) {
    // 从每个分组中移除关闭的标签页
    const updatedGroups = {};
    let hasChanges = false;

    for (const [groupName, items] of Object.entries(lastAiGroupResult)) {
      // 过滤掉关闭的标签页
      const filteredItems = items.filter(item => item.tab.id !== closedTabId);
      
      // 只保留还有标签页的分组
      if (filteredItems.length > 0) {
        updatedGroups[groupName] = filteredItems;
      }
      
      if (filteredItems.length !== items.length) {
        hasChanges = true;
      }
    }

    // 如果有变化，更新缓存
    if (hasChanges) {
      if (Object.keys(updatedGroups).length > 0) {
        lastAiGroupResult = updatedGroups;
      } else {
        // 如果没有分组了，清空缓存
        lastAiGroupResult = null;
        lastAiGroupTime = 0;
      }
    }
  }
}

/**
 * 调用 AI 模型进行智能分组
 * @param {Tab[]} tabs - 标签页数组
 */
async function aiGroupTabs(tabs) {
  try {
    // 显示加载状态
    const button = document.getElementById('aiGroupTabs');
    if (button) {
      button.classList.add('loading');
      button.innerHTML = `
        <span class="loading-spinner"></span>
        <span>AI分组中...</span>
      `;
    }

    // 检查缓存
    const currentTime = Date.now();
    if (lastAiGroupResult && 
        lastAiGroupTime && 
        (currentTime - lastAiGroupTime < AI_CACHE_TIMEOUT)) {
      console.log('使用缓存的AI分组结果');
      renderGroups(lastAiGroupResult);
      if (button) {
        button.classList.remove('loading');
        button.innerHTML = 'AI智能分组';
      }
      return lastAiGroupResult;
    }

    // 从设置中获取模型类型和 API Key
    const { settings } = await chrome.storage.local.get('settings');
    const modelType = settings.modelType || 'gemini';
    const apiKey = settings.apiKey;
    
    if (!apiKey) {
      alert('请在设置中填写 API Key');
      throw new Error('未设置 API Key');
    }

    // 准备标签页数据
    const tabsData = tabs.map((tab, index) => {
      try {
        const url = new URL(tab.url || 'chrome://newtab/');
        const pathSegments = url.pathname.split('/').filter(Boolean);
        return {
          index,
          title: tab.title || 'New Tab',
          url: tab.url || 'chrome://newtab/',
          domain: url.hostname,
          pathname: pathSegments.join('/'),
          isSpecial: url.protocol === 'chrome:' || url.protocol === 'chrome-extension:'
        };
      } catch (error) {
        return {
          index,
          title: tab.title || 'New Tab',
          url: 'chrome://newtab/',
          domain: 'newtab',
          isSpecial: true
        };
      }
    });

    // 调用 AI 模型
    const groupingResult = await callAIModel(modelType, apiKey, tabsData);

    // 创建与 AI 分组结果相匹配的分组数据结构
    const aiGroups = {};
    for (const [groupName, items] of Object.entries(groupingResult)) {
      // 过滤掉无效的标签页
      const validItems = items.filter(item => {
        const tab = tabs[item.index];
        return tab && tab.id && tab.title !== undefined;
      });
      
      if (validItems.length > 0) {
        aiGroups[groupName] = validItems.map(item => {
          const tab = tabs[item.index];
          return {
            tab,
            newTitle: tab.title || 'New Tab'
          };
        });
      }
    }

    // 如果没有有效的分组，抛出错误
    if (Object.keys(aiGroups).length === 0) {
      throw new Error('无法创建有效的分组，请重试');
    }

    // 缓存结果
    lastAiGroupResult = aiGroups;
    lastAiGroupTime = currentTime;

    // 使用 Chrome 标签组 API 创建实际的标签组
    for (const [groupName, items] of Object.entries(aiGroups)) {
      if (groupName === '未分类') continue; // 跳过未分类组
      
      try {
        // 创建新的标签组
        const group = await chrome.tabs.group({
          tabIds: items.map(item => item.tab.id)
        });
        
        // 设置标签组的颜色和标题
        const color = Object.keys(GROUP_COLORS)[Math.floor(Math.random() * Object.keys(GROUP_COLORS).length)];
        await chrome.tabGroups.update(group, {
          title: groupName,
          color: color
        });
      } catch (error) {
        console.error(`创建标签组 "${groupName}" 失败:`, error);
      }
    }

    // 使用 AI 分组结果渲染视图
    renderGroups(aiGroups);

    // 移除加载状态
    if (button) {
      button.classList.remove('loading');
      button.innerHTML = 'AI智能分组';
    }

    return groupingResult;
  } catch (error) {
    console.error('AI分组失败:', error);
    
    // 移除加载状态
    const button = document.getElementById('aiGroupTabs');
    if (button) {
      button.classList.remove('loading');
      button.innerHTML = 'AI智能分组';
      
      // 如果是429错误，显示更友好的提示
      if (error.message.includes('429') || error.message.includes('请求过于频繁')) {
        const retryAfter = 30; // 建议等待时间（秒）
        alert(`请求过于频繁，建议${retryAfter}秒后再试`);
        switchView('default');
        return;
      }
    }

    // 显示友好的错误提示
    alert(`AI分组失败: ${error.message}\n请稍后重试或切换到默认视图`);
    
    // 切换回默认视图
    switchView('default');
  }
}