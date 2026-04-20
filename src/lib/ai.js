/**
 * AI Module - 多 Prompt + 模板驱动
 *
 * 支持从模板目录动态加载 prompts，根据配置生成内容
 */

// 注意：fs/path 仅在 Node.js 环境下使用，浏览器版本不依赖这些

// ============ 简洁摘要生成（新增） ============

/**
 * 生成学习评价摘要
 * AI增强但不依赖AI：失败时使用 fallback
 *
 * @param {Object} data - 输入数据
 * @param {Object} data.student - 学生信息 { name, grade }
 * @param {Object} data.summary_stats - 统计数据 { completion_rate, completion_total, completion_completed, subject_distribution }
 * @param {Object} data.charts - 图表数据（可选）
 * @param {Object} options - 选项 { apiKey, timeout }
 * @returns {Promise<string>} 80字以内的评价摘要
 */
export async function generateSummary(data, options = {}) {
  const { apiKey, timeout = 5000 } = options;

  // 构造简洁的 prompt 数据（只传关键字段，不传原始数据）
  const promptData = {
    name: data.student?.name || '学员',
    grade: data.student?.grade || '',
    completion_rate: data.summary_stats?.completion_rate ?? 0,
    total: data.summary_stats?.completion_total ?? 0,
    completed: data.summary_stats?.completion_completed ?? 0,
    top_subjects: getTopSubjects(data.summary_stats),
    weak_subjects: getWeakSubjects(data.summary_stats)
  };

  // 构建结构化 prompt
  const prompt = buildSummaryPrompt(promptData);

  // 如果没有 API key，直接用 fallback
  if (!apiKey) {
    return generateSummaryFallback(promptData);
  }

  // 带超时的 AI 调用
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: '你是一个专业的教育评估助手。回复要求：80字以内，专业但易懂，语气鼓励性，最后给1句具体建议。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 150
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`API ${response.status}`);
    }

    const result = await response.json();
    const text = result.choices?.[0]?.message?.content?.trim() || '';

    // 验证返回内容长度
    if (text.length > 0 && text.length < 200) {
      return text;
    }

    return generateSummaryFallback(promptData);

  } catch (error) {
    console.warn('[AI] Summary generation failed, using fallback:', error.message);
    return generateSummaryFallback(promptData);
  }
}

/**
 * 构建摘要 prompt
 */
function buildSummaryPrompt(data) {
  return `学生：${data.name}（${data.grade}）
任务完成率：${data.completion_rate}%
完成情况：${data.completed}/${data.total} 项
重点学科：${data.top_subjects || '暂无数据'}
薄弱学科：${data.weak_subjects || '暂无数据'}

请生成80字以内的综合评语，要求：
1. 专业但易懂
2. 语气鼓励性
3. 最后给1句具体可执行的建议`;
}

/**
 * 获取 fallback 摘要
 */
function generateSummaryFallback(data) {
  const rate = data.completion_rate;
  const name = data.name;
  const weak = data.weak_subjects;

  if (rate >= 85) {
    return `${name}同学本阶段表现优异，任务完成率高，学习态度认真。希望继续保持，在${weak || '各学科'}上进一步突破。`;
  } else if (rate >= 70) {
    return `${name}同学整体表现稳定，完成率${rate}%。建议继续保持良好学习习惯，加强${weak || '薄弱环节'}的练习。`;
  } else if (rate >= 50) {
    return `${name}同学本阶段完成率${rate}%，有进步空间。建议分析未完成任务的原因，合理规划时间，提高${weak || '薄弱学科'}的学习效率。`;
  } else {
    return `${name}同学需要加强学习规划，建议主动与家长老师沟通，找出效率低下的原因，逐步建立良好的学习习惯。`;
  }
}

/**
 * 获取重点学科（完成率最高的）
 */
function getTopSubjects(summaryStats) {
  const dist = summaryStats?.subject_distribution;
  if (!dist?.subjects || dist.subjects.length === 0) return null;

  const data = dist.data || {};
  const top = dist.subjects
    .filter(s => (data[s]?.rate || 0) >= 70)
    .slice(0, 2)
    .join('、');
  return top || null;
}

/**
 * 获取薄弱学科（完成率低于60%的）
 */
function getWeakSubjects(summaryStats) {
  const dist = summaryStats?.subject_distribution;
  if (!dist?.subjects || dist.subjects.length === 0) return null;

  const data = dist.data || {};
  const weak = dist.subjects
    .filter(s => (data[s]?.rate || 0) < 60)
    .slice(0, 2)
    .join('、');
  return weak || null;
}

// ============ 主入口函数 ============

/**
 * 模板驱动的 AI 内容生成
 * @param {Object} data - 统计数据（来自 compute.js 的 summary_stats + charts）
 * @param {Object} templateConfig - 模板配置（来自 config.json 的 ai 字段）
 * @param {Object} options - 运行时选项
 * @returns {Promise<Object>} { ai: { summary, subject_comments, suggestions } }
 */
export async function generateAIContent(data, templateConfig = {}, options = {}) {
  const {
    prompts: promptNames = [],
    enabled = false,
    provider = 'openai',
    model = 'gpt-3.5-turbo',
    temperature = 0.7,
    maxTokens = 1000
  } = templateConfig;

  const result = {
    ai: {}
  };

  // 如果 AI 未启用或没有配置 prompts，返回默认内容
  if (!enabled || !promptNames || promptNames.length === 0) {
    return generateDefaultContent(data);
  }

  const runtimeOptions = {
    apiKey: options.apiKey || import.meta.env.VITE_OPENAI_API_KEY,
    provider,
    model,
    temperature,
    maxTokens,
    templateDir: options.templateDir || getDefaultTemplateDir()
  };

  // 依次执行每个 prompt
  for (const promptName of promptNames) {
    try {
      const content = await generateSinglePrompt(promptName, data, runtimeOptions);
      assignAIResult(result.ai, promptName, content);
    } catch (error) {
      console.error(`Prompt "${promptName}" 生成失败:`, error);
      // 使用默认内容作为 fallback
      result.ai[promptName] = getDefaultPromptContent(promptName, data);
    }
  }

  return result;
}

// ============ 单个 Prompt 生成 ============

/**
 * 生成单个 prompt 的内容
 * @param {string} promptName - prompt 名称（summary/subject/suggestion）
 * @param {Object} data - 填充数据
 * @param {Object} options - 运行时选项
 * @returns {Promise<string|Array|Object>}
 */
async function generateSinglePrompt(promptName, data, options = {}) {
  // 1. 尝试从模板目录加载 prompt 文件
  let promptTemplate = await loadPromptFromTemplate(promptName, options.templateDir);

  // 2. 如果文件不存在，使用内置默认 prompt
  if (!promptTemplate) {
    promptTemplate = getBuiltInPrompt(promptName);
  }

  // 3. 填充 prompt 模板
  const filledPrompt = fillPromptTemplate(promptTemplate, data);

  // 4. 调用 AI
  if (!options.apiKey) {
    return generateFallbackContent(promptName, data);
  }

  const response = await callAI(filledPrompt, options);

  // 5. 解析响应
  return parseAIResponse(promptName, response);
}

// ============ Prompt 加载 ============

/**
 * 从模板目录加载 prompt 文件
 * @param {string} promptName - prompt 名称
 * @param {string} templateDir - 模板目录路径
 * @returns {Promise<string|null>}
 */
async function loadPromptFromTemplate(promptName, templateDir) {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const promptPath = path.join(templateDir, 'prompts', `${promptName}.txt`);
    const content = await fs.promises.readFile(promptPath, 'utf-8');
    return content;
  } catch (error) {
    // 文件不存在，返回 null
    return null;
  }
}

// ============ Prompt 填充 ============

/**
 * 使用 {{变量}} 语法填充 prompt 模板
 * @param {string} promptTemplate - prompt 模板
 * @param {Object} data - 数据对象
 * @returns {string}
 */
export function fillPromptTemplate(promptTemplate, data) {
  if (!promptTemplate) return '';

  let result = promptTemplate;

  // 匹配 {{path.to.value}} 格式的占位符
  const placeholderRegex = /\{\{([^}]+)\}\}/g;

  result = result.replace(placeholderRegex, (match, pathStr) => {
    const value = getNestedValue(data, pathStr.trim());
    return value !== undefined && value !== null ? value : match;
  });

  // 处理条件块 {{#if condition}}...{{/if}}
  result = renderConditionals(result, data);

  // 处理循环块 {{#each items}}...{{/each}}
  result = renderLoops(result, data);

  return result;
}

/**
 * 获取嵌套属性值
 * @param {Object} obj - 对象
 * @param {string} path - 路径，如 "stats.completion.rate"
 * @returns {*}
 */
function getNestedValue(obj, path) {
  if (!path || !obj) return undefined;

  const keys = path.split('.');
  let current = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[key];
  }

  return current;
}

/**
 * 渲染条件块
 */
function renderConditionals(template, data) {
  const ifRegex = /\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g;

  return template.replace(ifRegex, (match, condition, content) => {
    const value = getNestedValue(data, condition.trim());
    const isTruthy = !!value;

    if (isTruthy) {
      const elseParts = content.split(/\{\{else\}\}/);
      return elseParts[0].trim();
    } else {
      const elseParts = content.split(/\{\{else\}\}/);
      return elseParts[1] ? elseParts[1].trim() : '';
    }
  });
}

/**
 * 渲染循环块
 */
function renderLoops(template, data) {
  const eachRegex = /\{\{#each\s+([^}]+)\}\}([\s\S]*?)\{\{\/each\}\}/g;

  return template.replace(eachRegex, (match, arrayPath, itemTemplate) => {
    const array = getNestedValue(data, arrayPath.trim());

    if (!Array.isArray(array) || array.length === 0) {
      return '';
    }

    return array.map((item, index) => {
      let itemContent = itemTemplate;

      // 替换 {{this}} 和 {{@index}}
      itemContent = itemContent.replace(/\{\{this\}\}/g, () =>
        typeof item === 'object' ? JSON.stringify(item) : String(item)
      );
      itemContent = itemContent.replace(/\{\{@index\}\}/g, () => index);

      // 替换 {{@key}} 形式
      if (typeof item === 'object' && item !== null) {
        for (const [key, value] of Object.entries(item)) {
          const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          itemContent = itemContent.replace(
            new RegExp(`\\{\\{@${escaped}\\}\\}`, 'g'),
            () => String(value)
          );
        }
      }

      // 递归替换嵌套占位符
      const placeholderRegex = /\{\{([^}]+)\}\}/g;
      itemContent = itemContent.replace(placeholderRegex, (m, p) => {
        const value = getNestedValue(item, p.trim());
        return value !== undefined && value !== null ? value : m;
      });

      return itemContent;
    }).join('');
  });
}

// ============ AI 调用 ============

/**
 * 调用 AI 接口
 */
async function callAI(prompt, options = {}) {
  const { apiKey, model = 'gpt-3.5-turbo', temperature = 0.7, maxTokens = 1000 } = options;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: '你是一个专业的教育评估助手，擅长分析学生学习数据并给出建设性的评语。回复内容应简洁、有建设性。'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature,
      max_tokens: maxTokens
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`AI API 错误: ${response.status} - ${error}`);
  }

  const result = await response.json();
  return result.choices?.[0]?.message?.content || '';
}

// ============ 响应解析 ============

/**
 * 解析 AI 响应，根据 prompt 类型返回不同结构
 */
function parseAIResponse(promptName, response) {
  switch (promptName) {
    case 'summary':
      // summary 直接返回文本
      return response.trim();

    case 'subject':
      // subject 返回 JSON 数组
      try {
        // 尝试提取 JSON
        const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/) ||
                         response.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[1]);
        }
        return JSON.parse(response);
      } catch {
        return response.trim();
      }

    case 'suggestion':
      // suggestion 返回 JSON 对象或文本
      try {
        const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/) ||
                         response.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[1]);
        }
        return JSON.parse(response);
      } catch {
        return response.trim();
      }

    default:
      return response.trim();
  }
}

// ============ 结果赋值 ============

/**
 * 根据 prompt 名称将结果赋值到 ai 对象
 */
function assignAIResult(ai, promptName, content) {
  switch (promptName) {
    case 'summary':
      ai.summary = content;
      break;
    case 'subject':
      ai.subject_comments = content;
      break;
    case 'suggestion':
      ai.suggestions = content;
      break;
    default:
      ai[promptName] = content;
  }
}

// ============ 默认内容 ============

/**
 * 生成默认内容（AI 未启用时）
 */
function generateDefaultContent(data) {
  return {
    ai: {
      summary: generateDefaultSummary(data),
      subject_comments: generateDefaultSubjectComments(data),
      suggestions: generateDefaultSuggestions(data)
    }
  };
}

/**
 * 获取默认 prompt 内容（文件不存在时的 fallback）
 */
function getBuiltInPrompt(promptName) {
  const prompts = {
    summary: `请根据以下学习数据，生成一段综合评语：

- 学生姓名: {{student.name}}
- 任务完成率: {{stats.completion_rate}}%
- 总任务数: {{stats.completion_total}} 项
- 已完成任务: {{stats.completion_completed}} 项
- 重点学科: {{top_subjects}}
- 学习趋势: {{monthly_trend}}

请生成一段鼓励性且有建设性的综合评语，控制在 100-150 字之间。`,

    subject: `请根据以下学科数据，为每个学科生成简短评价：

{{#each subjects.list}}
- 学科: {{this.name}}，任务数: {{this.count}}
{{/each}}

请返回 JSON 格式数组，每项包含 subject 和 comment 字段。`,

    suggestion: `请根据以下学习数据，生成具体的学习改进建议：

- 学生姓名: {{student.name}}
- 当前完成率: {{stats.completion_rate}}%
- 薄弱学科: {{weak_subjects}}
- 优势学科: {{strong_subjects}}

请返回 JSON 格式，包含 suggestions 数组，每项包含 type 和 content 字段。`
  };

  return prompts[promptName] || '';
}

/**
 * 获取默认 prompt 内容的 fallback 实现
 */
function generateFallbackContent(promptName, data) {
  switch (promptName) {
    case 'summary':
      return generateDefaultSummary(data);
    case 'subject':
      return generateDefaultSubjectComments(data);
    case 'suggestion':
      return generateDefaultSuggestions(data);
    default:
      return '';
  }
}

/**
 * 获取默认评语
 */
function generateDefaultSummary(data) {
  const rate = data.completion_rate || data.stats?.completion_rate || 0;
  const total = data.completion_total || data.stats?.completion_total || 0;
  const completed = data.completion_completed || data.stats?.completion_completed || 0;

  if (rate >= 90) {
    return `本月学习表现优异！共完成 ${completed}/${total} 项任务，完成率达到 ${rate}%。继续保持这种高效的学习状态，在各个学科都有不错的进展。相信通过持续努力，一定能够取得更大的进步！`;
  } else if (rate >= 70) {
    return `本月学习表现良好，共完成 ${completed}/${total} 项任务，完成率为 ${rate}%。大部分学科任务都得到了很好的执行，希望继续保持并发扬优点，同时注意加强薄弱环节的学习。`;
  } else if (rate >= 50) {
    return `本月完成了 ${completed}/${total} 项任务，完成率为 ${rate}%。建议认真分析未完成任务的原因，合理规划学习时间，提高学习效率，争取在下个月取得更好的成绩。`;
  } else {
    return `本月完成率为 ${rate}%，共完成 ${completed}/${total} 项任务。希望能够认真反思学习状态，找出效率低下的原因，制定切实可行的学习计划，逐步提高学习效果。`;
  }
}

/**
 * 获取默认学科评语
 */
function generateDefaultSubjectComments(data) {
  const subjects = data.subject_distribution?.subjects || data.subjects?.subjects || [];
  const subjectData = data.subject_distribution?.data || data.subjects?.data || {};

  return subjects.slice(0, 5).map(subject => ({
    subject,
    comment: subjectData[subject]?.rate >= 80 ? '表现出色，继续保持' :
             subjectData[subject]?.rate >= 60 ? '表现良好，稳中有进' : '需要加强练习'
  }));
}

/**
 * 获取默认建议
 */
function generateDefaultSuggestions(data) {
  return {
    suggestions: [
      { type: '学科平衡', content: '建议每天安排固定时间复习薄弱学科' },
      { type: '时间管理', content: '建议使用番茄工作法提高学习效率' },
      { type: '习惯养成', content: '建议建立错题本，定期复习巩固' }
    ]
  };
}

/**
 * 获取默认模板目录
 */
function getDefaultTemplateDir() {
  return path.join(process.cwd(), 'src', 'templates', 'learning_report');
}

// ============ 辅助函数 ============

/**
 * 准备 AI 填充用的数据（从 compute 结果转换）
 */
export function prepareAIData(computeResult, studentInfo = {}) {
  const { summary_stats, charts } = computeResult;

  // 提取数据用于 prompt 填充
  const topSubjects = (summary_stats.subject_distribution?.subjects || [])
    .slice(0, 3)
    .join('、') || '暂无数据';

  const weakSubjects = Object.entries(summary_stats.subject_distribution?.data || {})
    .filter(([, v]) => v.rate < 60)
    .slice(0, 2)
    .map(([k]) => k)
    .join('、') || '暂无';

  const strongSubjects = Object.entries(summary_stats.subject_distribution?.data || {})
    .filter(([, v]) => v.rate >= 80)
    .slice(0, 2)
    .map(([k]) => k)
    .join('、') || '暂无';

  const recentMonths = Object.entries(summary_stats.monthly_count?.data || {})
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 3)
    .map(([month, info]) => `${month}(${info.rate}%)`)
    .join(' → ') || '暂无数据';

  return {
    student: {
      name: studentInfo.name || '学员',
      grade: studentInfo.grade || '',
      class: studentInfo.class || ''
    },
    stats: {
      completion_rate: summary_stats.completion_rate || 0,
      completion_total: summary_stats.completion_total || 0,
      completion_completed: summary_stats.completion_completed || 0
    },
    subjects: {
      list: charts.subjects?.list || [],
      distribution: summary_stats.subject_distribution || { subjects: [], data: {} }
    },
    monthly: {
      count: summary_stats.monthly_count || { months: [], data: {} },
      trend: recentMonths
    },
    charts: {
      monthly: charts.monthly || { bars: [] },
      subjects: charts.subjects || { list: [] }
    },
    // 别名，方便 prompt 使用
    top_subjects: topSubjects,
    weak_subjects: weakSubjects,
    strong_subjects: strongSubjects,
    monthly_trend: recentMonths
  };
}

// ============ 兼容旧 API ============

/**
 * @deprecated 使用 generateAIContent(data, config) 替代
 */
export async function generateEvaluation(data, dimensions, options = {}) {
  // 旧 API 返回结构兼容
  const result = {};
  for (const dim of dimensions) {
    result[dim.key] = {
      score: dim.defaultScore || 75,
      comment: dim.defaultComment || '继续保持'
    };
  }
  return result;
}

export default {
  generateAIContent,
  generateSummary,
  generateEvaluation,
  fillPromptTemplate,
  prepareAIData
};
