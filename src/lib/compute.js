/**
 * Compute Module - 模板驱动计算
 *
 * 支持按需计算：根据 compute.config.json 中的 metrics 配置
 * 返回统一结构：{ summary_stats: {...}, charts: {...} }
 */

/**
 * 主入口函数：模板驱动的统计计算
 * @param {Array} records - 原始记录数据
 * @param {Object} config - 来自 compute.config.json 的配置
 * @returns {Object} 统一返回结构 { summary_stats, charts }
 */
export function compute(records, config = {}) {
  if (!records || !Array.isArray(records)) {
    records = [];
  }

  const metrics = config.metrics || [];
  const statsConfig = config.stats || {};
  const summary_stats = {};
  const charts = {};

  // 按需计算：遍历配置中的 metrics，动态调用对应计算函数
  for (const metric of metrics) {
    const metricKey = metric.key || metric;
    const outputPath = metric.output || metricKey;
    const options = getMetricOptions(metric, statsConfig);

    switch (metricKey) {
      case 'completion_rate':
      case 'completionRate':
        Object.assign(summary_stats, calcCompletionRate(records, options));
        break;

      case 'monthly_count':
      case 'monthlyCount':
        Object.assign(summary_stats, calcMonthlyCount(records, options));
        charts.monthly = formatMonthlyChart(summary_stats.monthly);
        break;

      case 'subject_distribution':
      case 'subjectDistribution':
        Object.assign(summary_stats, calcSubjectDistribution(records, options));
        charts.subjects = formatSubjectChart(summary_stats.subjects);
        break;

      case 'total_tasks':
      case 'totalTasks':
        summary_stats.totalTasks = records.length;
        break;

      case 'completed_tasks':
      case 'completedTasks':
        summary_stats.completedTasks = countCompleted(records, options);
        break;

      default:
        console.warn(`Unknown metric: ${metricKey}`);
    }
  }

  // 如果没有配置 metrics，至少计算基本统计
  if (metrics.length === 0) {
    const defaultOptions = getDefaultOptions(statsConfig);
    Object.assign(summary_stats, calcCompletionRate(records, defaultOptions));
    Object.assign(summary_stats, calcMonthlyCount(records, { dateField: defaultOptions.dateField }));
    Object.assign(summary_stats, calcSubjectDistribution(records, { subjectField: defaultOptions.subjectField }));
    charts.monthly = formatMonthlyChart(summary_stats.monthly);
    charts.subjects = formatSubjectChart(summary_stats.subjects);
  }

  // ========== 新增：增强分析数据 ==========
  // 连续未完成天数 & 最长连续完成
  const streakData = calcStreakData(records);
  summary_stats.consecutiveMissDays = streakData.consecutiveMissDays;
  summary_stats.maxStreak = streakData.maxStreak;

  // 完成率趋势（基于时间序列前半 vs 后半）
  summary_stats.completionTrend = calcCompletionTrend(records);

  // 学习时长分析
  const durationData = calcDurationStats(records);
  summary_stats.avgSessionDuration = durationData.avg;
  summary_stats.durationVariance = durationData.variance;

  // 学科统计 & 强弱科目
  const subjectStats = calcSubjectStats(summary_stats.subject_distribution);
  summary_stats.subjectStats = subjectStats;
  summary_stats.weakSubjects = subjectStats.weakSubjects;
  summary_stats.strongSubjects = subjectStats.strongSubjects;

  // 行为标签
  summary_stats.behaviorTags = calcBehaviorTags(summary_stats);

  // 学科详细活动汇总（用于 AI 评语）
  summary_stats.subjectDetails = calcSubjectDetails(records);

  return {
    summary_stats,
    charts,
    _meta: {
      totalRecords: records.length,
      computedAt: new Date().toISOString(),
      metricsUsed: metrics.map(m => typeof m === 'string' ? m : m.key)
    }
  };
}

/**
 * 计算连续未完成天数和最长连续完成天数
 */
function calcStreakData(records) {
  if (!records || records.length === 0) {
    return { consecutiveMissDays: 0, maxStreak: 0 };
  }

  // 按日期排序
  const sortedRecords = [...records].sort((a, b) => {
    const dateA = parseDateToObject(a.date);
    const dateB = parseDateToObject(b.date);
    if (!dateA || !dateB) return 0;
    return dateA - dateB;
  });

  let maxStreak = 0;
  let currentStreak = 0;
  let consecutiveMissDays = 0;
  let maxConsecutiveMiss = 0;
  let lastDate = null;

  for (const record of sortedRecords) {
    const dateObj = parseDateToObject(record.date);
    if (!dateObj) continue;

    const isCompleted = checkCompleted(record);

    if (isCompleted) {
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
      consecutiveMissDays = 0; // 重置连续未完成
    } else {
      currentStreak = 0;
      consecutiveMissDays++;

      // 检查是否跨天（如果有间隔）
      if (lastDate) {
        const dayDiff = Math.round((dateObj - lastDate) / (1000 * 60 * 60 * 24));
        if (dayDiff > 1) {
          // 中间有空缺，不计入连续未完成
          consecutiveMissDays = 0;
        }
      }
      maxConsecutiveMiss = Math.max(maxConsecutiveMiss, consecutiveMissDays);
    }

    lastDate = dateObj;
  }

  return {
    consecutiveMissDays: maxConsecutiveMiss,
    maxStreak
  };
}

/**
 * 计算完成率趋势（基于时间序列前半 vs 后半）
 */
function calcCompletionTrend(records) {
  if (!records || records.length < 4) {
    return '波动'; // 数据太少无法判断
  }

  // 按日期排序
  const sortedRecords = [...records].sort((a, b) => {
    const dateA = parseDateToObject(a.date);
    const dateB = parseDateToObject(b.date);
    if (!dateA || !dateB) return 0;
    return dateA - dateB;
  });

  const mid = Math.floor(sortedRecords.length / 2);
  const firstHalf = sortedRecords.slice(0, mid);
  const secondHalf = sortedRecords.slice(mid);

  const firstRate = calcRate(firstHalf);
  const secondRate = calcRate(secondHalf);

  const diff = secondRate - firstRate;

  if (diff >= 10) return '上升';
  if (diff <= -10) return '下降';
  return '波动';
}

function calcRate(recordList) {
  if (!recordList || recordList.length === 0) return 0;
  const completed = recordList.filter(r => checkCompleted(r)).length;
  return Math.round((completed / recordList.length) * 100);
}

/**
 * 计算学习时长统计
 */
function calcDurationStats(records) {
  const durations = [];

  for (const record of records) {
    if (record.duration && typeof record.duration === 'number') {
      durations.push(record.duration);
    } else if (record.startTime && record.endTime) {
      // 尝试从时间计算时长
      const start = parseTimeToMinutes(record.startTime);
      const end = parseTimeToMinutes(record.endTime);
      if (start !== null && end !== null) {
        let diff = end - start;
        if (diff > 0 && diff < 600) { // 合理时长范围 0-10小时
          durations.push(diff);
        }
      }
    }
  }

  if (durations.length === 0) {
    return { avg: 0, variance: '稳定' };
  }

  const avg = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);

  // 计算方差（简单判断稳定度）
  const squaredDiffs = durations.map(d => Math.pow(d - avg, 2));
  const variance = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / durations.length);

  // 方差超过平均值30%视为波动
  const varianceRatio = variance / avg;
  const varianceLabel = varianceRatio > 0.3 ? '波动' : '稳定';

  return { avg: Math.round(avg), variance: varianceLabel };
}

function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.toString().match(/^(\d{1,2}):(\d{2})$/);
  if (!parts) return null;
  return parseInt(parts[1]) * 60 + parseInt(parts[2]);
}

/**
 * 计算学科统计
 */
function calcSubjectStats(subjectDist) {
  if (!subjectDist || !subjectDist.data) {
    return { chinese: null, math: null, english: null, weakSubjects: [], strongSubjects: [] };
  }

  const data = subjectDist.data;

  const result = {
    chinese: data['语文'] ? { rate: data['语文'].rate, count: data['语文'].total } : null,
    math: data['数学'] ? { rate: data['数学'].rate, count: data['数学'].total } : null,
    english: data['英语'] ? { rate: data['英语'].rate, count: data['英语'].total } : null,
    weakSubjects: [],
    strongSubjects: []
  };

  // 薄弱科目：完成率低于70%
  if (result.chinese && result.chinese.rate < 70) result.weakSubjects.push('chinese');
  if (result.math && result.math.rate < 70) result.weakSubjects.push('math');
  if (result.english && result.english.rate < 70) result.weakSubjects.push('english');

  // 强项科目：完成率高于85%
  if (result.chinese && result.chinese.rate >= 85) result.strongSubjects.push('chinese');
  if (result.math && result.math.rate >= 85) result.strongSubjects.push('math');
  if (result.english && result.english.rate >= 85) result.strongSubjects.push('english');

  return result;
}

/**
 * 计算学科详细活动汇总（用于 AI 评语）
 * 从 records 中提取每个学科的具体活动、知识点、问题
 */
function calcSubjectDetails(records) {
  const subjectMap = {
    chinese: '语文', math: '数学', english: '英语',
    wuli: '物理', huaxue: '化学', shengwu: '生物',
    lishi: '历史', dili: '地理', zhengzhi: '政治',
    kexue: '科学', tiyu: '体育', meishu: '美术', yinyue: '音乐'
  };

  const details = {};

  for (const record of records) {
    const tasks = record.tasks || [];
    for (const task of tasks) {
      const subject = normalizeSubject(task.subject) || '其他';
      if (!details[subject]) {
        details[subject] = {
          activities: [],       // 具体活动内容
          knowledgePoints: [],  // 涉及的知识点
          completed: 0,         // 完成数
          total: 0              // 总任务数
        };
      }

      details[subject].total++;
      if (task.status === 'completed') details[subject].completed++;

      // 提取活动内容（去掉状态符号）
      const content = task.content?.replace(/^[√✓✅△]\s*/, '').trim() || '';
      if (content && !details[subject].activities.includes(content)) {
        details[subject].activities.push(content);
      }

      // 从内容中提取知识点关键词
      const kp = extractKnowledgePoints(content, subject);
      for (const p of kp) {
        if (!details[subject].knowledgePoints.includes(p)) {
          details[subject].knowledgePoints.push(p);
        }
      }
    }
  }

  // 计算每个学科的完成率
  for (const subject of Object.keys(details)) {
    details[subject].rate = details[subject].total > 0
      ? Math.round((details[subject].completed / details[subject].total) * 100)
      : 0;
    // 提取主要问题（完成率低的）
    if (details[subject].rate < 70) {
      details[subject].issues = ['完成率偏低，需要加强'];
    }
  }

  return details;
}

/**
 * 从活动内容中提取知识点
 */
function extractKnowledgePoints(content, subject) {
  const points = [];
  const text = content.toLowerCase();

  // 语文知识点
  if (subject === '语文' || subject === 'chinese') {
    const yuKeywords = ['字帖', '拼音', '阅读', '理解', '作文', '古诗', '默写', '课文', '园地', '看图写话', '生字', '笔画', '偏旁', '组词', '造句', '阅读理解', '名著', '日记'];
    for (const kw of yuKeywords) {
      if (text.includes(kw)) points.push(kw);
    }
  }

  // 数学知识点
  if (subject === '数学' || subject === 'math') {
    const shuKeywords = ['计算', '加减法', '乘法', '除法', '应用题', '几何', '面积', '周长', '体积', '分数', '小数', '方程', '同步', '卷子', '错题', '五三', '预习', '复习', '思维'];
    for (const kw of shuKeywords) {
      if (text.includes(kw)) points.push(kw);
    }
  }

  // 英语知识点
  if (subject === '英语' || subject === 'english') {
    const yingKeywords = ['单词', '绘本', '课文', '朗读', '听力', '口语', '默写', 'Lesson', '背诵', '翻译', '语法', '词汇'];
    for (const kw of yingKeywords) {
      if (text.includes(kw)) points.push(kw);
    }
  }

  return points;
}
function calcBehaviorTags(summaryStats) {
  const tags = [];

  // 执行力判断
  if (summaryStats.completion_rate < 70 && summaryStats.consecutiveMissDays >= 3) {
    tags.push('执行力不稳定');
  }

  // 学习节奏判断
  if (summaryStats.durationVariance === '波动') {
    tags.push('学习节奏不稳定');
  }

  // 连续完成判断
  if (summaryStats.maxStreak >= 7) {
    tags.push('持续性强');
  } else if (summaryStats.maxStreak < 3 && summaryStats.completion_rate > 50) {
    tags.push('间歇性努力型');
  }

  // 科目均衡判断
  const weakCount = summaryStats.weakSubjects?.length || 0;
  if (weakCount >= 2) {
    tags.push('偏科明显');
  }

  // 时长判断
  if (summaryStats.avgSessionDuration > 120) {
    tags.push('学习投入度高');
  } else if (summaryStats.avgSessionDuration < 60 && summaryStats.completion_rate > 50) {
    tags.push('高效型学习');
  }

  return tags;
}

/**
 * 解析日期字符串为 Date 对象
 */
function parseDateToObject(dateStr) {
  if (!dateStr) return null;

  const str = dateStr.toString().trim();

  // MM.DD 或 M.DD 格式
  const mmddMatch = str.match(/^(\d{1,2})\.(\d{1,2})\.?$/);
  if (mmddMatch) {
    const month = parseInt(mmddMatch[1], 10);
    const day = parseInt(mmddMatch[2], 10);
    const year = month >= 11 || month <= 4 ? (month <= 4 ? 2026 : 2025) : 2025;
    return new Date(year, month - 1, day);
  }

  // YYYY.MM.DD 格式
  const ymdMatch = str.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (ymdMatch) {
    return new Date(parseInt(ymdMatch[1]), parseInt(ymdMatch[2]) - 1, parseInt(ymdMatch[3]));
  }

  return null;
}

/**
 * 计算任务完成率
 * @param {Array} records - 任务记录
 * @param {Object} options - 配置选项
 * @returns {Object} { completion_rate, completion_total, completion_completed, completion_details }
 */
export function calcCompletionRate(records, options = {}) {
  const {
    completedField = 'completed',
    statusField = 'status',
    completedValues = ['true', 'yes', '✅', '1', '完成', 'completed', 'done']
  } = options;

  if (!records || records.length === 0) {
    return {
      completion_rate: 0,
      completion_total: 0,
      completion_completed: 0,
      completion_details: []
    };
  }

  let completed = 0;
  const total = records.length;
  const details = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const isCompleted = checkCompleted(record, completedField, statusField, completedValues);

    if (isCompleted) completed++;

    details.push({
      index: i,
      isCompleted,
      record
    });
  }

  return {
    completion_rate: total > 0 ? Math.round((completed / total) * 100) : 0,
    completion_total: total,
    completion_completed: completed,
    completion_partial: details.filter(d => d.isCompleted === 'partial').length,
    completion_details: details
  };
}

/**
 * 计算月度任务统计
 * @param {Array} records - 任务记录
 * @param {Object} options - 配置选项
 * @returns {Object} { monthly_count: { months: [], data: {} } }
 */
export function calcMonthlyCount(records, options = {}) {
  const {
    dateField = 'date',
    format = 'YYYY.MM'
  } = options;

  const monthlyData = {};

  if (!records || records.length === 0) {
    return {
      monthly_count: { months: [], data: {} }
    };
  }

  for (const record of records) {
    const dateValue = record[dateField];
    if (!dateValue) continue;

    const monthKey = parseDate(dateValue, format);
    if (!monthKey) continue;

    if (!monthlyData[monthKey]) {
      monthlyData[monthKey] = {
        total: 0,
        completed: 0,
        records: []
      };
    }

    monthlyData[monthKey].total++;
    monthlyData[monthKey].records.push(record);

    if (checkCompleted(record)) {
      monthlyData[monthKey].completed++;
    }
  }

  // 排序月份
  const months = Object.keys(monthlyData).sort();
  const data = {};

  for (const month of months) {
    const m = monthlyData[month];
    data[month] = {
      total: m.total,
      completed: m.completed,
      rate: m.total > 0 ? Math.round((m.completed / m.total) * 100) : 0
    };
  }

  return {
    monthly_count: { months, data }
  };
}

/**
 * 计算学科分布统计
 * 支持两种记录结构：
 * 1. record.subject - 直接字段
 * 2. record.tasks[].subject - 嵌套任务数组
 * @param {Array} records - 任务记录
 * @param {Object} options - 配置选项
 * @returns {Object} { subject_distribution: { subjects: [], data: {} } }
 */
export function calcSubjectDistribution(records, options = {}) {
  const {
    subjectField = 'subject'
  } = options;

  const distribution = {};

  if (!records || records.length === 0) {
    return {
      subject_distribution: { subjects: [], data: {} }
    };
  }

  for (const record of records) {
    // 获取任务列表（兼容两种结构）
    const tasks = record.tasks;

    if (tasks && Array.isArray(tasks) && tasks.length > 0) {
      // 从每个任务中提取学科
      for (const task of tasks) {
        let subject = normalizeSubject(task.subject) || '未分类';

        if (!distribution[subject]) {
          distribution[subject] = {
            total: 0,
            completed: 0,
            items: []
          };
        }

        distribution[subject].total++;
        distribution[subject].items.push(task);

        if (task.status === 'completed' || task.status === true) {
          distribution[subject].completed++;
        }
      }
    } else {
      // 无任务时使用 record.subject
      let subject = normalizeSubject(record[subjectField]) || '未分类';

      if (!distribution[subject]) {
        distribution[subject] = {
          total: 0,
          completed: 0,
          items: []
        };
      }

      distribution[subject].total++;
      distribution[subject].items.push(record);

      if (checkCompleted(record)) {
        distribution[subject].completed++;
      }
    }
  }

  // 按总数降序排序
  const subjects = Object.keys(distribution).sort(
    (a, b) => distribution[b].total - distribution[a].total
  );

  const data = {};
  for (const subject of subjects) {
    const s = distribution[subject];
    data[subject] = {
      total: s.total,
      completed: s.completed,
      rate: s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0
    };
  }

  return {
    subject_distribution: { subjects, data }
  };
}

/**
 * 格式化月度图表数据（用于柱状图）
 * @param {Object} monthlyCount - { months: [], data: {} }
 * @returns {Object} { bars: [] }
 */
export function formatMonthlyChart(monthlyCount) {
  if (!monthlyCount || !monthlyCount.months) {
    return { bars: [] };
  }

  const { months, data } = monthlyCount;
  const maxRate = Math.max(...months.map(m => data[m]?.rate || 0), 1);

  const bars = months.map(month => ({
    month: month.split('.')[1] || month, // 只显示月份数字
    value: data[month]?.rate || 0,
    height: Math.max(((data[month]?.rate || 0) / maxRate) * 100, 5)
  }));

  return { bars };
}

/**
 * 格式化学科图表数据（用于饼图/标签）
 * @param {Object} subjectDist - { subjects: [], data: {} }
 * @returns {Object} { list: [] }
 */
export function formatSubjectChart(subjectDist) {
  if (!subjectDist || !subjectDist.subjects) {
    return { list: [] };
  }

  const { subjects, data } = subjectDist;
  const topN = 10; // 默认显示前10个

  const list = subjects.slice(0, topN).map(subject => ({
    name: subject,
    count: data[subject]?.total || 0,
    rate: data[subject]?.rate || 0
  }));

  return { list };
}

/**
 * 获取指标配置选项
 * @param {Object} metric - metric 配置对象
 * @param {Object} statsConfig - stats 配置
 * @returns {Object} 合并后的选项
 */
function getMetricOptions(metric, statsConfig) {
  if (typeof metric === 'string') {
    return { ...statsConfig };
  }

  return {
    ...statsConfig,
    ...(metric.options || {})
  };
}

/**
 * 获取默认选项
 * @param {Object} statsConfig
 * @returns {Object}
 */
function getDefaultOptions(statsConfig) {
  return {
    completedField: statsConfig.completedField || 'completed',
    statusField: statsConfig.statusField || 'status',
    dateField: statsConfig.dateField || 'date',
    subjectField: statsConfig.subjectField || 'subject',
    completedValues: ['true', 'yes', '✅', '1', '完成', 'completed', 'done']
  };
}

/**
 * 检查记录是否完成
 * @param {Object} record - 记录
 * @param {string} completedField - 完成字段名
 * @param {string} statusField - 状态字段名
 * @param {Array} completedValues - 完成状态值列表
 * @returns {boolean|string} true/false 或 'partial'
 */
function checkCompleted(record, completedField = 'completed', statusField = 'status', completedValues = null) {
  const values = completedValues || ['true', 'yes', '✅', '1', '完成', 'completed', 'done'];
  const partialValues = ['△', '部分完成', 'partial'];

  // 检查完成字段
  if (completedField && record[completedField] !== undefined) {
    const val = record[completedField];
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') {
      const lower = val.toLowerCase();
      if (values.includes(lower)) return true;
      if (partialValues.includes(val)) return 'partial';
    }
  }

  // 检查状态字段
  if (statusField && record[statusField] !== undefined) {
    const status = record[statusField].toString().toLowerCase();
    if (values.includes(status)) return true;
    if (partialValues.includes(record[statusField])) return 'partial';
  }

  return false;
}

/**
 * 统计已完成数量
 * @param {Array} records
 * @param {Object} options
 * @returns {number}
 */
function countCompleted(records, options = {}) {
  let count = 0;
  for (const record of records) {
    if (checkCompleted(record, options.completedField, options.statusField, options.completedValues)) {
      count++;
    }
  }
  return count;
}

/**
 * 解析日期值
 * @param {*} dateValue
 * @param {string} format
 * @returns {string|null}
 */
function parseDate(dateValue, format) {
  if (!dateValue) return null;

  // 处理 "MM.DD" 或 "M.DD" 格式（如 "12.20", "1.10", "03.10"）
  if (typeof dateValue === 'string') {
    const mmddMatch = dateValue.match(/^(\d{1,2})\.(\d{1,2})$/);
    if (mmddMatch) {
      const month = parseInt(mmddMatch[1], 10);
      const day = parseInt(mmddMatch[2], 10);
      // 判断年份：11-12月视为2025年，1-4月视为2026年
      let year = 2025;
      if (month >= 1 && month <= 4) {
        year = 2026;
      }
      return `${year}.${month.toString().padStart(2, '0')}`;
    }
  }

  let date;

  if (typeof dateValue === 'number') {
    // Excel 日期序列号
    date = new Date((dateValue - 25569) * 86400 * 1000);
  } else if (typeof dateValue === 'string') {
    date = new Date(dateValue);
  } else if (dateValue instanceof Date) {
    date = dateValue;
  }

  if (isNaN(date?.getTime())) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');

  return `${year}.${month}`;
}

/**
 * 标准化学科名称
 * @param {string} subject
 * @returns {string}
 */
function normalizeSubject(subject) {
  const subjectMap = {
    '数学': '数学',
    '语文': '语文',
    '英语': '英语',
    '物理': '物理',
    '化学': '化学',
    '生物': '生物',
    '历史': '历史',
    '地理': '地理',
    '政治': '政治',
    '科学': '科学',
    '体育': '体育',
    '美术': '美术',
    '音乐': '音乐'
  };

  return subjectMap[subject] || subject;
}

// ============ 兼容旧 API ============

/**
 * @deprecated 使用 compute(records, config) 替代
 */
export function completionRate(records, options = {}) {
  const result = calcCompletionRate(records, options);
  return {
    total: result.completion_total,
    completed: result.completion_completed,
    rate: result.completion_rate,
    details: result.completion_details
  };
}

/**
 * @deprecated 使用 compute(records, config) 替代
 */
export function monthlyCount(records, options = {}) {
  const result = calcMonthlyCount(records, options);
  return result.monthly_count;
}

/**
 * @deprecated 使用 compute(records, config) 替代
 */
export function subjectDistribution(records, options = {}) {
  const result = calcSubjectDistribution(records, options);
  return result.subject_distribution;
}

/**
 * @deprecated 使用 compute(records, config) 替代
 */
export function computeStats(records, config = {}) {
  return compute(records, config);
}

export default {
  compute,
  calcCompletionRate,
  calcMonthlyCount,
  calcSubjectDistribution,
  formatMonthlyChart,
  formatSubjectChart,
  // 兼容旧 API
  completionRate,
  monthlyCount,
  subjectDistribution,
  computeStats
};
