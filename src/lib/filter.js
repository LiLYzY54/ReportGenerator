/**
 * 日期范围过滤模块
 *
 * 按日期范围过滤记录，提供周报/月报等不同数据范围支持
 */

/**
 * 解析日期字符串为 Date 对象
 * 支持格式：MM.DD, YYYY.MM.DD
 */
export function parseDateToObject(dateStr) {
  if (!dateStr) return null;

  const str = dateStr.toString().trim().replace(/^0+/, '');

  // MM.DD 或 M.DD 格式
  const mmddMatch = str.match(/^(\d{1,2})\.(\d{1,2})\.?$/);
  if (mmddMatch) {
    const month = parseInt(mmddMatch[1], 10);
    const day = parseInt(mmddMatch[2], 10);
    // 判断年份：11-12月视为2025年，1-4月视为2026年
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
 * 按日期范围过滤记录
 */
export function filterRecordsByRange(records, startDate, endDate) {
  if (!records || !Array.isArray(records)) return [];
  if (!startDate && !endDate) return records;

  const start = startDate instanceof Date ? startDate : parseDateToObject(startDate);
  const end = endDate instanceof Date ? endDate : parseDateToObject(endDate);

  if (!start && !end) return records;

  return records.filter(r => {
    const d = parseDateToObject(r.date);
    if (!d) return false;
    if (start && end) return d >= start && d <= end;
    if (start) return d >= start;
    if (end) return d <= end;
    return true;
  });
}

/**
 * 从记录数组获取日期范围
 */
export function getFullRange(records) {
  if (!records || records.length === 0) {
    return { start: null, end: null };
  }

  let minDate = null;
  let maxDate = null;

  for (const r of records) {
    const d = parseDateToObject(r.date);
    if (!d) continue;

    if (!minDate || d < minDate) minDate = d;
    if (!maxDate || d > maxDate) maxDate = d;
  }

  return { start: minDate, end: maxDate };
}

/**
 * 获取指定日期所在的周范围（周一到周日）
 */
export function getWeekRange(date = new Date()) {
  const d = date instanceof Date ? new Date(date) : new Date(date);

  const day = d.getDay(); // 0=周日, 1=周一...
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { start: monday, end: sunday };
}

/**
 * 获取上周范围
 */
export function getLastWeekRange() {
  const today = new Date();
  const lastWeek = new Date(today);
  lastWeek.setDate(today.getDate() - 7);
  return getWeekRange(lastWeek);
}

/**
 * 格式化日期为显示字符串
 */
export function formatDateRange(start, end) {
  if (!start || !end) return '';

  const fmt = (d) => {
    const month = d.getMonth() + 1;
    const day = d.getDate();
    return `${month}.${day}`;
  };

  return `${fmt(start)} — ${fmt(end)}`;
}

export default {
  parseDateToObject,
  filterRecordsByRange,
  getFullRange,
  getWeekRange,
  getLastWeekRange,
  formatDateRange
};