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

    // 原始任务记录（用于提取更多细节，不再截断）
    rawRecords: records.map(r => ({
      date: r.date,
      duration: r.duration,
      tasks: (r.tasks || []).map(t => ({
        subject: t.subject,
        content: t.content,
        status: t.status,
        duration: t.duration
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
    return `${subjectName}: 完成率${info.rate || 0}%，具体任务记录：${(info.activities || []).join('、')}`;
  }).join('\n');

  return `你现在是一位顶级教研专家和学情诊断师，你正在为一位学生编写《深度学情复盘报告》。

【核心原则】
1. **去模板化**：严禁使用“基础扎实”、“稳步提升”、“有待加强”、“继续保持”等任何像机器人生成的套话。
2. **证据导向**：每一句点评必须对应原始记录中的具体任务。如果孩子本周做了“20道乘法口算”，你的点评必须提到这“20道乘法口算”。
3. **因果推断**：不要只列出数据，要分析数据背后的行为逻辑。比如：某天耗时极长但完成度低，是因为知识点生疏还是专注力问题？

【输出结构要求】

一、 综合评价 (overall)
这一部分是报告的灵魂。必须包含：
- **深度复盘**：结合本周的完成趋势（${data.completionTrend}）和学习节奏（${data.durationVariance}），通过具体的任务完成情况（参考 rawRecords），重构孩子的学习状态。
- **痛点诊断**：点出本周最严重的一个问题。必须非常具体，例如：“周三和周四在[具体任务名]上出现了明显的执行断层，这反映出...”
- **成长亮点**：挖掘数据中的闪光点，同样需要具体到任务。

二、 学科专项评估 (subjects)
针对每个学科，按以下逻辑分析：
- **事实陈述**：该学科完成率是多少，做了哪些具体事情（列举具体书名、练习名）。
- **能力诊断**：基于这些具体事情的表现（是否完成、是否耗时），判断孩子在该学科的掌握程度。
- **个性化点睛**：给出一句针对该学科的、非模板化的建议。

三、 靶向行动建议 (suggestions)
给出4条精准建议。每条建议必须满足：
- **高度定制化**：不能是“多做题”，必须是“针对[某某具体问题]，在下周[某某时间段]进行[某某具体动作]”。
- **可量化**：包含明确的频率、时长或目标（例如：正确率提升至90%）。
- **逻辑闭环**：告诉孩子为什么这么做能解决他本周出现的问题。

【语气风格】
- 犀利且专业，像一位资深名师在面对面跟家长谈话。
- 拒绝鸡汤，拒绝废话。

【输入数据】
学生：${data.name} (${data.grade})
整体完成率：${data.completionRate}%
完成趋势：${data.completionTrend}
连续未完成天数：${data.consecutiveMissDays}
最长连续完成：${data.maxStreak}天
平均单次时长：${data.avgSessionDuration}分钟
学习节奏：${data.durationVariance}
行为标签：${data.behaviorTags.join('、') || '暂无'}

学科原始数据汇总：
${subjectsJson}

详细任务流水日志：
${JSON.stringify(data.rawRecords)}

输出 JSON 格式：
{
  "overall": "...",
  "subjects": {
    "语文": "...",
    "数学": "...",
    "英语": "..."
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