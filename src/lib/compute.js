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
        // 同时输出 charts 数据用于柱状图
        charts.monthly = formatMonthlyChart(summary_stats.monthly);
        break;

      case 'subject_distribution':
      case 'subjectDistribution':
        Object.assign(summary_stats, calcSubjectDistribution(records, options));
        // 同时输出 charts 数据用于饼图/标签
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

      // 可扩展：添加新的计算类型
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
