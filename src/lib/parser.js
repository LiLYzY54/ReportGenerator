/**
 * Excel Parser Module
 * 解析伴学周报 Excel 文件，输出标准数据结构
 *
 * 支持格式：
 * - 日期：12.20. / 12.21 / 12.3 0 / 2.10. / 2。11 等
 * - 时间：datetime.time对象 / 1556-1708 / 1429 等
 * - 任务：多行文本，【学科】标签，√/✓/✅ 状态
 */

import * as XLSX from 'xlsx';

/**
 * 解析 Excel 文件（浏览器端）
 * @param {File} file - 上传的 Excel 文件
 * @returns {Promise<{records: Array, metadata: Object}>}
 */
export async function parseExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const result = parseWorkbook(workbook);
        resolve(result);
      } catch (error) {
        reject(new Error(`Excel 解析失败: ${error.message}`));
      }
    };

    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 解析 Excel 文件路径（服务端/Node.js）
 * @param {string} filePath - Excel 文件路径
 * @returns {Promise<{records: Array, metadata: Object}>}
 */
export async function parseExcelFile(filePath) {
  const fs = await import('fs');
  const XLSX = await import('xlsx');

  const data = fs.readFileSync(filePath);
  const workbook = XLSX.read(data, { type: 'buffer' });
  return parseWorkbook(workbook);
}

/**
 * 解析 workbook
 * @param {Object} workbook - XLSX workbook
 * @returns {{records: Array, metadata: Object}}
 */
function parseWorkbook(workbook) {
  const records = [];
  let metadata = {};

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    if (!jsonData || jsonData.length === 0) continue;

    // 识别结构类型并解析
    const structureType = detectStructure(jsonData);

    if (structureType === '伴学周报') {
      const parsed = parseStudyReport(jsonData);
      records.push(...parsed.records);
      metadata = { ...metadata, ...parsed.metadata };
    } else {
      // 通用解析
      const parsed = parseGeneric(jsonData, sheetName);
      records.push(...parsed.records);
    }
  }

  return { records, metadata };
}

/**
 * 检测 Excel 结构类型
 * @param {Array} jsonData - 行数据
 * @returns {string} '伴学周报' | '通用'
 */
function detectStructure(jsonData) {
  // 检查是否有典型的伴学周报特征
  const firstRows = jsonData.slice(0, 10).flat().join('');

  if (firstRows.includes('姓名') &&
      firstRows.includes('年级') &&
      (firstRows.includes('语文') || firstRows.includes('数学') || firstRows.includes('英语'))) {
    return '伴学周报';
  }

  return '通用';
}

/**
 * 解析伴学周报格式
 * @param {Array} jsonData - 行数据
 * @returns {{records: Array, metadata: Object}}
 */
function parseStudyReport(jsonData) {
  const records = [];
  const metadata = {};

  let phase = 1; // 当前阶段
  let inWinterBreak = false;

  for (let i = 0; i < jsonData.length; i++) {
    const row = jsonData[i];
    if (!row || row.length === 0) continue;

    // 提取列值（容错：不超过数组长度）
    const colA = getCellValue(row, 0);
    const colB = getCellValue(row, 1);
    const colC = getCellValue(row, 2);
    const colD = getCellValue(row, 3);
    const colE = getCellValue(row, 4);
    const colF = getCellValue(row, 5);

    // 元数据行检测
    if (i === 1 && colA) {
      // 第2行：学生基本信息
      metadata.student = {
        name: colA,
        grade: getCellValue(row, 1),
        gender: getCellValue(row, 2),
        location: getCellValue(row, 3),
        startDate: parseDate(colE || getCellValue(row, 4)),
        textbooks: parseTextbooks(getCellValue(row, 5) || getCellValue(row, 5))
      };
      continue;
    }

    // 检测阶段变化
    if (isPhaseChange(colA, colE)) {
      const newPhase = detectPhase(colA, colE);
      if (newPhase && newPhase !== phase) {
        phase = newPhase;
        inWinterBreak = (phase === 2);
      }
    }

    // 跳过表头和说明行
    if (isHeaderOrNote(colA, colE, i)) continue;

    // 跳过无效日期行
    const dateStr = parseDate(colA);
    if (!dateStr) continue;

    // 解析时间
    const startTime = parseTime(colB);
    const endTime = parseTime(colD);

    // 解析任务内容
    const taskContent = colF;
    if (!taskContent) {
      // 有日期但无任务，记录空白记录
      records.push({
        date: dateStr,
        startTime,
        endTime,
        phase,
        tasks: [],
        status: 'unknown',
        raw: { colA, colB, colD, colF }
      });
      continue;
    }

    // 解析任务列表
    const tasks = parseTasks(taskContent);

    // 计算整体状态
    const status = calculateStatus(tasks);

    records.push({
      date: dateStr,
      startTime,
      endTime,
      phase,
      tasks,
      status,
      duration: calculateDuration(startTime, endTime),
      raw: { colA, colB, colD, colF }
    });
  }

  metadata.phase = phase;
  return { records, metadata };
}

/**
 * 解析通用格式
 * @param {Array} jsonData - 行数据
 * @param {string} sheetName - sheet 名称
 * @returns {{records: Array}}
 */
function parseGeneric(jsonData, sheetName) {
  const records = [];
  const headers = jsonData[0] || [];

  for (let i = 1; i < jsonData.length; i++) {
    const row = jsonData[i];
    if (!row || row.length === 0) continue;

    const record = {};
    record._sheetName = sheetName;
    record._rowIndex = i;

    headers.forEach((header, index) => {
      if (header) {
        record[camelCase(header.toString().trim())] = row[index] ?? '';
      }
    });

    // 尝试解析日期
    if (record.date) {
      record.date = parseDate(record.date);
    }

    records.push(record);
  }

  return { records };
}

/**
 * 获取单元格值（容错）
 */
function getCellValue(row, index) {
  if (!row || index >= row.length) return null;
  const val = row[index];
  if (val === null || val === undefined) return null;

  // 处理 datetime.time 对象
  if (typeof val === 'object' && val !== null && 'hours' in val && 'minutes' in val) {
    return val; // 返回原始 datetime.time 对象
  }

  // 处理普通 Date 对象
  if (typeof val === 'object' && val !== null && val instanceof Date) {
    return val;
  }

  // 对于数字（时间分数等），保持为数字
  if (typeof val === 'number') {
    return val;
  }

  // 其他类型转字符串
  return val.toString().trim();
}

/**
 * 解析日期
 * 支持格式：12.20. / 12.21 / 12.3 0 / 2.10. / 2。11 / 2025.12.16
 */
function parseDate(dateInput) {
  if (!dateInput) return null;

  let dateStr = dateInput.toString().trim();

  // 如果是 datetime.time 对象（不应该出现在日期列，但容错）
  if (typeof dateStr === 'object' && dateStr.hours !== undefined) {
    return null;
  }

  // 清理常见问题
  dateStr = dateStr.replace('。', '.').replace(' ', '');
  dateStr = dateStr.replace(/^0+(\d)/, '$1'); // 去掉前导0

  // 匹配模式：M.D / MM.DD / M.DD. / MM.DD.
  const patterns = [
    /^(\d{1,2})\.(\d{1,2})\.?$/,  // 12.20 / 12.20. / 2.10.
    /^(\d{1,2})\.(\d)\.?$/,        // 12.3 / 2.10.
    /^(\d)(\d{2})$/,              // 120 (作为 1.20)
  ];

  for (const pattern of patterns) {
    const match = dateStr.match(pattern);
    if (match) {
      let month = parseInt(match[1], 10);
      let day = parseInt(match[2], 10);

      // 修复 12.3 格式 (12.30 表示 12月30日)
      if (month > 12 && day <= 12) {
        [month, day] = [day, month];
      }

      // 判断年份（简单逻辑：1-2月视为12月/1月）
      let year = 2025;
      if (month >= 11 || month <= 2) {
        year = month <= 2 ? 2026 : 2025;
      }

      return `${month.toString().padStart(2, '0')}.${day.toString().padStart(2, '0')}`;
    }
  }

  // 尝试标准日期格式 YYYY.MM.DD
  const stdMatch = dateStr.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (stdMatch) {
    return `${stdMatch[2].padStart(2, '0')}.${stdMatch[3].padStart(2, '0')}`;
  }

  return dateStr; // 返回原始值
}

/**
 * 解析时间
 * 支持格式：datetime.time对象 / 小数(如0.7916代表19:00) / 1556 / 858-1143 / 14:56
 */
function parseTime(timeInput) {
  if (!timeInput) return null;

  // datetime.time 对象
  if (typeof timeInput === 'object' && timeInput.hours !== undefined && timeInput.minutes !== undefined) {
    const h = (timeInput.hours || 0).toString().padStart(2, '0');
    const m = (timeInput.minutes || 0).toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  // 小数值（Excel时间格式，如 0.791666666666667 代表 19:00）
  if (typeof timeInput === 'number' && timeInput > 0 && timeInput < 1) {
    const totalMinutes = Math.round(timeInput * 24 * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  const timeStr = timeInput.toString().trim().replace('：', ':');

  // HHMM-HHMM 格式 (如 1556-1708 或 858-1143)
  const rangeMatch = timeStr.match(/^(\d{3,4})-(\d{3,4})$/);
  if (rangeMatch) {
    const start = rangeMatch[1].padStart(4, '0');
    const end = rangeMatch[2].padStart(4, '0');
    return `${start.slice(0, 2)}:${start.slice(2)}`;
  }

  // HHMM 格式 (如 1556 或 1429 或 943)
  const hmMatch = timeStr.match(/^(\d{3,4})$/);
  if (hmMatch) {
    const padded = hmMatch[1].padStart(4, '0');
    const h = parseInt(padded.slice(0, 2), 10);
    const m = parseInt(padded.slice(2), 10);
    // 容错：如果分钟超过59，可能格式是 HMM
    if (m > 59) {
      return `${h}:${m.toString().padStart(2, '0')}`;
    }
    return `${padded.slice(0, 2)}:${padded.slice(2)}`;
  }

  // HH:MM 格式
  const colonMatch = timeStr.match(/^(\d{1,2}):(\d{2})/);
  if (colonMatch) {
    return `${colonMatch[1].padStart(2, '0')}:${colonMatch[2]}`;
  }

  return timeStr;
}

/**
 * 解析任务内容
 * 支持：
 * - 【语文】任务1\n【数学】任务2
 * - 1.任务1\n2.任务2
 * - 任务1✓\n任务2
 */
function parseTasks(taskContent) {
  if (!taskContent) return [];

  const tasks = [];

  // 统一换行符
  const content = taskContent.toString().replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 按【学科】分割
  const subjectBlocks = content.split(/【(语文|数学|英语|综合)】/);

  if (subjectBlocks.length > 1) {
    // 有学科标签的格式
    for (let i = 1; i < subjectBlocks.length; i += 2) {
      const subject = subjectBlocks[i];
      const items = subjectBlocks[i + 1] || '';

      const itemList = items.split('\n').filter(s => s.trim());

      for (const item of itemList) {
        const parsed = parseTaskItem(item, subject);
        if (parsed) tasks.push(parsed);
      }
    }
  } else {
    // 无学科标签，按行分割或按数字分割
    const lines = content.split('\n').filter(s => s.trim());

    for (const line of lines) {
      // 移除行号 (1. 2. 3.)
      const cleanLine = line.replace(/^\d+[.):、]\s*/, '').trim();
      if (cleanLine) {
        const parsed = parseTaskItem(cleanLine, detectSubject(cleanLine));
        if (parsed) tasks.push(parsed);
      }
    }
  }

  return tasks;
}

/**
 * 解析单个任务项
 */
function parseTaskItem(itemStr, defaultSubject = '综合') {
  if (!itemStr || itemStr.length === 0) return null;

  // 清理文本
  let text = itemStr.trim();
  text = text.replace(/^敬壹\s*\d*月?\d*日.*?任务/, ''); // 移除开头的时间标记

  // 检测状态
  let status = 'unknown';
  if (/^[√✓✅]/.test(text) || /[√✓✅]$/.test(text)) {
    status = 'completed';
    text = text.replace(/^[√✓✅]\s*/, '').replace(/\s*[√✓✅]$/, '');
  } else if (/^部分/.test(text) || /△/.test(text)) {
    status = 'partial';
    text = text.replace(/^部分\s*/, '');
  }

  // 解析时间和内容
  let content = text;
  let duration = null;

  // 匹配 "XX分钟" 或 "XX小时"
  const durationMatch = text.match(/(\d+)\s*分钟|(\d+)\s*小时/);
  if (durationMatch) {
    duration = durationMatch[1] ? parseInt(durationMatch[1], 10) : parseInt(durationMatch[2], 10) * 60;
    // 移除时间标记
    content = text.replace(/(\d+)\s*分钟|(\d+)\s*小时/, '').trim();
  }

  // 移除状态符号
  content = content.replace(/^[√✓✅]\s*/, '').trim();

  if (!content) return null;

  // 识别学科
  const subject = detectSubject(content) || defaultSubject;

  return {
    subject,
    content,
    duration,
    status
  };
}

/**
 * 检测学科
 */
function detectSubject(text) {
  const t = text.toLowerCase();

  if (t.includes('语文') || t.includes('拼音') || t.includes('作文') ||
      t.includes('阅读') || t.includes('古诗') || t.includes('默写') ||
      t.includes('字帖') || t.includes('园地') || t.includes('课文')) {
    return '语文';
  }

  if (t.includes('数学') || t.includes('计算') || t.includes('卷子') ||
      t.includes('错题') || t.includes('同步') || t.includes('五三') ||
      t.includes('预习') || t.includes('几何') || t.includes('面积')) {
    return '数学';
  }

  if (t.includes('英语') || t.includes('单词') || t.includes('绘本') ||
      t.includes('课文') || t.includes('Lesson') || t.includes('熟读')) {
    return '英语';
  }

  if (t.includes('打卡') || t.includes('手抄报') || t.includes('课外')) {
    return '综合';
  }

  return null;
}

/**
 * 计算任务状态
 */
function calculateStatus(tasks) {
  if (!tasks || tasks.length === 0) return 'unknown';

  const completed = tasks.filter(t => t.status === 'completed').length;
  const partial = tasks.filter(t => t.status === 'partial').length;
  const unknown = tasks.filter(t => t.status === 'unknown').length;

  if (completed === tasks.length) return 'completed';
  if (completed + partial === tasks.length) return 'completed';
  if (completed > 0) return 'partial';
  return 'unknown';
}

/**
 * 计算时长（分钟）
 */
function calculateDuration(startTime, endTime) {
  if (!startTime || !endTime) return null;

  const start = parseTime(startTime);
  const end = parseTime(endTime);

  if (!start || !end) return null;

  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);

  if (isNaN(sh) || isNaN(eh)) return null;

  let minutes = (eh * 60 + em) - (sh * 60 + sm);
  if (minutes < 0) minutes += 24 * 60; // 跨天情况

  return minutes;
}

/**
 * 检测是否为阶段变化标记
 */
function isPhaseChange(colA, colE) {
  const text = `${colA} ${colE}`.toLowerCase();
  return text.includes('阶段') || text.includes('寒假') || text.includes('开学');
}

/**
 * 检测阶段
 */
function detectPhase(colA, colE) {
  const text = `${colA} ${colE}`;

  if (text.includes('阶段一') || text.includes('衔接')) return 1;
  if (text.includes('阶段二') || text.includes('寒假')) return 2;
  if (text.includes('阶段三') || text.includes('开学')) return 3;

  return null;
}

/**
 * 检测是否为表头或说明行
 */
function isHeaderOrNote(colA, colE, rowIndex) {
  // 前10行容错
  if (rowIndex < 10) {
    const text = `${colA} ${colE}`.toLowerCase();
    if (text.includes('姓名') || text.includes('年级') ||
        text.includes('家长') || text.includes('学生特点') ||
        text.includes('沟通时间') || text.includes('发送学习') ||
        text.includes('调试设备') || text.includes('以下为') ||
        text.includes('需要重点关注')) {
      return true;
    }
  }
  return false;
}

/**
 * 解析教材版本
 */
function parseTextbooks(text) {
  if (!text) return [];

  return text.split(/[\n,，]/).filter(s => s.trim()).map(s => {
    const parts = s.split('：');
    return {
      subject: parts[0]?.trim(),
      version: parts[1]?.trim() || ''
    };
  });
}

/**
 * 驼峰命名转换
 */
function camelCase(str) {
  return str
    .replace(/[\s\-_]+/g, ' ')
    .split(' ')
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join('');
}

/**
 * 根据 mapping.json 映射配置，从 records 中提取特定字段
 */
export function applyMapping(records, mapping) {
  const result = {};

  for (const [key, fieldPath] of Object.entries(mapping)) {
    if (typeof fieldPath === 'string') {
      const value = fieldPath.split('.').reduce((current, k) => current?.[k], records);
      result[key] = value;
    } else if (typeof fieldPath === 'object' && fieldPath.type === 'computed') {
      result[key] = fieldPath.fn(records);
    }
  }

  return result;
}

export default { parseExcel, parseExcelFile, applyMapping };
