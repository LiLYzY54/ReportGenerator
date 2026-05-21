/**
 * AI Module - 学习分析报告生成
 *
 * 基于结构化数据的 AI 评语生成
 */

/**
 * 生成学习评价摘要
 */
export async function generateSummary(data, options = {}) {
  const { 
    apiKey = import.meta.env.VITE_OPENAI_API_KEY, 
    baseUrl = 'https://api.deepseek.com', 
    model = 'deepseek-chat',
    timeout = 25000 
  } = options;

  // 1. 构造 Prompt 数据
  const promptData = buildPromptData(data);
  const prompt = buildAnalysisPrompt(promptData);

  if (!apiKey || apiKey === 'YOUR_OPENAI_API_KEY' || apiKey.length < 5) {
    return generateSummaryFallback(promptData, '未检测到有效的 API Key 配置');
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: '你是一个极其犀利且专业的教研诊断专家。你通过分析原始流水日志，点破学生本周学习的真相。严禁废话。'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.error?.message || `API 访问受阻 (状态码: ${response.status})`);
    }

    const result = await response.json();
    const text = result.choices?.[0]?.message?.content?.trim() || '';
    
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
      return { ...parsed, isAI: true };
    } catch (e) {
      return { overall: text, isAI: true };
    }
    } catch (error) {
    console.error('[AI] 诊断失败:', error.message);
    return generateSummaryFallback(promptData, error.message);
    }
    }
/**
 * 构建 Prompt 数据：将所有原始细节准备好
 */
function buildPromptData(data) {
  const stats = data.summary_stats || {};
  const records = data.records || [];
  
  // 核心：构建详细的每日任务流水日志（不截断）
  const taskLog = records.map(r => {
    const tasks = (r.tasks || []).map(t => 
      `【${t.subject}】${t.content} (${t.duration || '?'}min) -> ${t.status === 'completed' ? '已完成' : '未完成'}`
    ).join(' | ');
    return `${r.date}: ${tasks || '无任务记录'}`;
  }).join('\n');

  return {
    name: data.student?.name || '学员',
    grade: data.student?.grade || '',
    completionRate: stats.completion_rate ?? 0,
    behaviorTags: stats.behaviorTags || [],
    taskLog,
    subjectStats: stats.subjectDetails || {}
  };
}

/**
 * 构建分析报告 Prompt：严厉约束，强制引用
 */
function buildAnalysisPrompt(data) {
  return `请为学生 ${data.name} 撰写一份深度复盘报告。

【本周原始任务流水日志】：
${data.taskLog}

【硬性要求（不满足将被惩罚）】：
1. **去模板化**：禁止使用"基础扎实"、"继续努力"、"有待加强"、"表现优异"等任何像机器人生成的套话。
2. **证据导向**：在综合评价和学科评价中，你必须点名提到日志中出现的具体任务名称（例如：引用具体的练习册名、具体的课文名、具体的知识点）。
3. **因果推断**：分析日志中的异常点。比如：为什么某天时长极短但标为完成？为什么某学科任务一直未完成？
4. **语气风格**：犀利、专业、直接，像顶级名师在跟家长直接谈话，直击痛点。

输出 JSON 格式：
{
  "overall": "必须结合具体日期和具体任务名，重构孩子本周的真实学习状态，点出最深刻的问题。",
  "subjects": {
    "语文": "引用日志中具体任务名，评价能力水平，给出下周一个具体到任务的动作建议。",
    "数学": "引用日志中具体任务名，评价能力水平，给出下周一个具体到任务的动作建议。",
    "英语": "引用日志中具体任务名，评价能力水平，给出下周一个具体到任务的动作建议。"
  },
  "suggestions": [
    "极其具体的建议1（必须含具体任务名和执行频率）",
    "极其具体的建议2",
    "极其具体的建议3",
    "极其具体的建议4"
  ]
}`;
}

/**
 * Fallback 逻辑：透明化提示
 */
function generateSummaryFallback(data, errorMsg = '') {
  return {
    overall: `[基础分析模式] ${data.name}本周完成率${data.completionRate}%。由于 API 配置问题（${errorMsg}），当前无法进行 AI 深度诊断。请在 GitHub Secret 中配置 VITE_OPENAI_API_KEY。`,
    subjects: Object.keys(data.subjectStats).reduce((acc, sub) => ({
      ...acc, 
      [sub]: `[基础分析] ${sub}本周完成率${data.subjectStats[sub].rate}%。建议针对该学科未完成的任务进行补测。`
    }), {}),
    suggestions: [
      "请检查 API Key 配置以开启 AI 深度诊断",
      "根据明细表，重点复盘未完成的任务",
      "保持稳定的学习时长，避免节奏剧烈波动",
      "针对薄弱学科，建议每日固定 20 分钟专项练习"
    ],
    isAI: false,
    debug: errorMsg
  };
}

export default { generateSummary };
