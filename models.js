/**
 * @typedef {Object} AIModelConfig
 * @property {string} name - 模型名称
 * @property {string} apiKey - API密钥
 * @property {string} endpoint - API端点
 */

/**
 * @type {Object.<string, {name: string, endpoint: string}>}
 */
const MODEL_CONFIGS = {
  'gemini': {
    name: 'Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent'
  },
  'deepseek': {
    name: 'Deepseek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions'
  }
};

/**
 * 获取AI分组提示词
 * @param {Array} tabsData - 标签页数据
 * @returns {string} 提示词
 */
function getPrompt(tabsData) {
  return `作为标签页管理助手，请将标签页智能分组。

要求：
1. 分组规则：
   - 优先按内容主题分组（如"购物"、"社交"、"开发"等）
   - 同一网站的不同页面应该根据内容分到不同组
   - 特殊页面（chrome://等）归为"系统"组
   - 新标签页归为"未分类"组
   
2. 分组限制：
   - 每组3-6个标签页
   - 组名2-4个汉字，以emoji开头，用空格分隔
   - 组名要简洁精确
   - 相似主题合并到同一组
   
3. 命名规范：
   - 使用场景类名称，如"前端开发"而不是"编程"
   - 避免使用网站名作为组名
   - 使用动宾结构，如"看视频"而不是"视频"
   - 特殊页面统一用"系统"

标签页数据：
${JSON.stringify(tabsData, null, 2)}

请返回如下格式的JSON：
{
  "组名称": [
    {
      "index": 标签页索引
    }
  ]
}`;
}

/**
 * 调用Gemini API
 * @param {string} apiKey - API密钥
 * @param {string} prompt - 提示词
 * @returns {Promise<Object>} 分组结果
 */
async function callGeminiAPI(apiKey, prompt) {
  const response = await fetch(`${MODEL_CONFIGS.gemini.endpoint}?key=${apiKey}`, {
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
    throw new Error(`Gemini API请求失败: ${response.status}`);
  }

  const data = await response.json();
  if (!data.candidates?.[0]?.content) {
    throw new Error('Gemini API返回数据格式错误');
  }

  return JSON.parse(extractJsonFromResponse(data.candidates[0].content.parts[0].text));
}

/**
 * 调用Deepseek API
 * @param {string} apiKey - API密钥
 * @param {string} prompt - 提示词
 * @returns {Promise<Object>} 分组结果
 */
async function callDeepseekAPI(apiKey, prompt) {
  const response = await fetch(MODEL_CONFIGS.deepseek.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 2000
    })
  });

  if (!response.ok) {
    throw new Error(`Deepseek API请求失败: ${response.status}`);
  }

  const data = await response.json();
  if (!data.choices?.[0]?.message?.content) {
    throw new Error('Deepseek API返回数据格式错误');
  }

  return JSON.parse(extractJsonFromResponse(data.choices[0].message.content));
}

/**
 * 从响应文本中提取JSON
 * @param {string} text - 响应文本
 * @returns {string} JSON字符串
 */
function extractJsonFromResponse(text) {
  try {
    JSON.parse(text);
    return text;
  } catch (e) {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return jsonMatch[0];
    }
    throw new Error('无法从响应中提取有效的JSON');
  }
}

/**
 * 调用AI模型API
 * @param {string} modelType - 模型类型
 * @param {string} apiKey - API密钥
 * @param {Array} tabsData - 标签页数据
 * @returns {Promise<Object>} 分组结果
 */
async function callAIModel(modelType, apiKey, tabsData) {
  const prompt = getPrompt(tabsData);

  switch (modelType) {
    case 'gemini':
      return await callGeminiAPI(apiKey, prompt);
    case 'deepseek':
      return await callDeepseekAPI(apiKey, prompt);
    default:
      throw new Error(`不支持的模型类型: ${modelType}`);
  }
}

export {
  MODEL_CONFIGS,
  callAIModel,
  extractJsonFromResponse
}; 