/**
 * AI Module - 学习分析报告生成
 *
 * 基于结构化数据的 AI 评语生成
 * 支持动态学科数量，基于实际记录内容生成个性化评语
 */

/**
 * 生成学习评价摘要
 * AI增强但不依赖AI：失败时使用 fallback
 */
export async function generateSummary(data, options = {}) {
  const { apiKey, timeout = 8000 } = options;

  // 构造结构化数据
  const promptData = buildPromptData(data);

  // 构建 prompt
  const prompt = buildAnalysisPrompt(promptData);

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
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: '你是一个专业的教研老师，擅长分析学生学习数据并给出精准、具体的评价和改进建议。你的风格是专业、直接、不说废话、不灌鸡汤。回复必须基于数据，每句话都要有具体依据。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 2000
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`API ${response.status}`);
    }

    const result = await response.json();
    const text = result.choices?.[0]?.message?.content?.trim() || '';

    if (text.length > 0) {
      // 尝试解析 JSON
      try {
        const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/(\{[\s\S]*\})/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[1]);
        }
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    return generateSummaryFallback(promptData);

  } catch (error) {
    console.warn('[AI] Summary generation failed, using fallback:', error.message);
    return generateSummaryFallback(promptData);
  }
}

/**
 * 构建 Prompt 数据
 */
function buildPromptData(data) {
  const stats = data.summary_stats || {};
  const records = data.records || [];

  // 获取所有学科（从 subjectDetails 动态获取，不限于语数外）
  const subjectDetails = stats.subjectDetails || {};
  const allSubjects = Object.keys(subjectDetails);

  // 构建每个学科的详细活动列表
  const subjectActivities = {};
  for (const [key, detail] of Object.entries(subjectDetails)) {
    subjectActivities[key] = {
      activities: detail.activities || [],
      knowledgePoints: detail.knowledgePoints || [],
      rate: detail.rate || 0,
      total: detail.total || 0,
      completed: detail.completed || 0
    };
  }

  return {
    name: data.student?.name || '学员',
    grade: data.student?.grade || '',

    // 基本统计
    completionRate: stats.completion_rate ?? 0,
    completionTrend: stats.completionTrend || '波动',
    consecutiveMissDays: stats.consecutiveMissDays ?? 0,
    maxStreak: stats.maxStreak ?? 0,

    // 时长数据
    avgSessionDuration: stats.avgSessionDuration ?? 0,
    durationVariance: stats.durationVariance || '稳定',

    // 行为标签
    behaviorTags: stats.behaviorTags || [],

    // 所有学科列表（动态）
    allSubjects,
    subjectActivities,

    // 原始任务记录（用于提取更多细节）
    rawRecords: records.slice(0, 20).map(r => ({
      date: r.date,
      tasks: (r.tasks || []).map(t => ({
        subject: t.subject,
        content: t.content,
        status: t.status
      }))
    }))
  };
}

/**
 * 构建分析报告 prompt
 * 学科数量根据实际数据动态变化
 */
function buildAnalysisPrompt(data) {
  const subjectsJson = data.allSubjects.map(s => {
    const info = data.subjectActivities[s] || {};
    const subjectName = s === 'chinese' ? '语文' : s === 'math' ? '数学' : s === 'english' ? '英语' : s;
    return `${subjectName}: 完成率${info.rate || 0}%，活动包括：${(info.activities || []).join('、')}`;
  }).join('\n');

  return `你现在不是在写普通评语，而是在做"学习分析报告"。

【任务要求】

1. 所有结论必须基于输入数据，不允许空话或泛化评价
2. 每一段内容必须包含三层：
   - 数据现象（发生了什么）
   - 行为判断（为什么会这样）
   - 改进建议（怎么做）

【具体要求】

一、综合评价（overall）
必须包含：
- 完成率 + 趋势判断
- 是否存在执行问题（结合 consecutiveMissDays / behaviorTags）
- 明确指出一个核心问题
- 基于实际记录的内容给出具体观察

二、学科评价（subjects）
根据实际记录的学科数量，动态生成评价。每科必须包含：
- 具体数据（完成率 / 占比）
- 具体活动（从 records 中提取的实际任务）
- 能力判断（基于活动内容推断）
- 明确短板或优势
- 一个具体改进动作（带频率）

输出格式示例：
"语文（完成率85%）: 本周完成了字帖练习、阅读理解训练。从活动内容看，理解力较好，但写字速度有待提升。建议每天增加10分钟写字练习。"

禁止使用：
"基础扎实""有待提升""继续保持"这类模板话

三、改进建议（suggestions）

输出4条建议，每条必须：
- 可执行（具体到频率/次数）
- 针对问题（不能泛化）
- 不重复
- 立足孩子本身情况，不要省略

示例（合格）：
"每天进行15分钟计算练习，重点针对乘法口诀，每周复盘一次正确率，目标是3天内正确率提升至90%"

示例（不合格）：
加强练习

【语气要求】
- 像教研老师，不要像客服
- 不要鸡汤
- 不要模板化

输入数据：
学生：${data.name} (${data.grade})
整体完成率：${data.completionRate}%
完成趋势：${data.completionTrend}
连续未完成天数：${data.consecutiveMissDays}
最长连续完成：${data.maxStreak}天
平均单次时长：${data.avgSessionDuration}分钟
学习节奏：${data.durationVariance}
行为标签：${data.behaviorTags.join('、') || '暂无'}

各学科详情：
${subjectsJson}

原始任务记录：
${JSON.stringify(data.rawRecords, null, 2)}

输出 JSON：
{
  "overall": "...",
  "subjects": {
    "语文": "...",
    "数学": "...",
    "英语": "..."
    // 可根据实际数据增加更多学科
  },
  "suggestions": ["...", "...", "...", "..."]
}`;
}

/**
 * 获取 fallback 摘要
 */
function generateSummaryFallback(data) {
  const { completionRate, allSubjects, subjectActivities, behaviorTags, avgSessionDuration, durationVariance } = data;

  // 动态生成学科评语
  const subjectComments = {};
  const subjectNameMap = { chinese: '语文', math: '数学', english: '英语' };

  for (const key of allSubjects) {
    const info = subjectActivities[key] || {};
    const name = subjectNameMap[key] || key;
    const rate = info.rate || 0;

    let comment = `${name}完成率${rate}%。`;
    if (rate >= 85) {
      comment += `${(info.activities || []).slice(0, 3).join('、')}表现优异，建议继续保持并适度拓展。`;
    } else if (rate >= 70) {
      comment += `整体稳定，${(info.activities || []).slice(0, 2).join('、')}有一定基础，可加强${(info.knowledgePoints || []).slice(0, 1)}训练。`;
    } else {
      comment += `${(info.activities || []).slice(0, 2).join('、')}需要重点关注，建议增加练习频率。`;
    }
    subjectComments[name] = comment;
  }

  // 默认学科评语（如果没有解析出学科）
  if (Object.keys(subjectComments).length === 0) {
    subjectComments['语文'] = '本周语文学习记录较少，建议持续关注。';
    subjectComments['数学'] = '本周数学学习记录较少，建议持续关注。';
    subjectComments['英语'] = '本周英语学习记录较少，建议持续关注。';
  }

  let overall = '';
  if (completionRate >= 85) {
    overall = `${data.name}本阶段完成率${completionRate}%，表现优异。${data.behaviorTags.join('、') || '学习状态良好'}。`;
  } else if (completionRate >= 70) {
    overall = `${data.name}本阶段完成率${completionRate}%，整体稳定但有提升空间。${behaviorTags.join('、') || '注意巩固'}。`;
  } else {
    overall = `${data.name}本阶段完成率${completionRate}%，存在明显问题。${behaviorTags.join('、') || '建议优先解决执行力问题'}。`;
  }

  return {
    overall,
    subjects: subjectComments,
    suggestions: [
      `每天固定时间复习薄弱科目，每次30分钟，坚持2周`,
      `建立错题本，每周复盘一次，重点解决重复错误`,
      `注意学习节奏稳定性，避免长时间连续学习后中断`,
      `增加与孩子的学习沟通，了解具体困难点针对性解决`
    ]
  };
}

export default { generateSummary };