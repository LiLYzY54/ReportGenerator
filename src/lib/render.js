/**
 * 安全模板引擎
 *
 * 使用位置匹配处理嵌套块，支持任意深度的 {{#each}} 和 {{#if}}
 */

/**
 * HTML 转义
 */
function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 获取嵌套属性值
 */
function getValue(path, data, localData = null) {
  if (!path) return undefined;

  if (path === 'this') return localData;

  if (path.startsWith('this.')) {
    const subPath = path.slice(5);
    const keys = subPath.split('.');
    let current = localData;
    if (current) {
      for (const key of keys) {
        if (current === null || current === undefined) return '';
        current = current[key];
      }
      return current;
    }
    return '';
  }

  const orParts = path.split('||').map(s => s.trim());
  const actualPath = orParts[0];
  const defaultValue = orParts[1] ? orParts[1].replace(/^['"]|['"]$/g, '') : undefined;

  let current = data;
  for (const key of actualPath.split('.')) {
    if (current === null || current === undefined) return defaultValue;
    current = current[key];
  }

  if (current === null || current === undefined || current === '') {
    return defaultValue !== undefined ? defaultValue : '';
  }
  return current;
}

/**
 * 查找配对的 {{/each}} 或 {{/if}} 位置
 * @param {string} html - 模板字符串
 * @param {number} startPos - 起始位置（指向 {{#each 或 {{#if 之后）
 * @param {string} tag - 'each' 或 'if'
 * @returns {number} - 配对的结束标签位置，或 -1
 */
function findMatchingEnd(html, startPos, tag) {
  // 从 startPos 之后开始查找
  let pos = startPos;
  let depth = 1; // 已经进入了一层

  while (pos < html.length) {
    const nextOpen = html.indexOf('{{#' + tag, pos);
    const nextClose = html.indexOf('{{/' + tag + '}}', pos);

    if (nextClose === -1) return -1; // 没有找到关闭标签

    if (nextOpen !== -1 && nextOpen < nextClose) {
      // 找到一个嵌套的开标签
      depth++;
      pos = nextOpen + 1;
    } else {
      // 找到关闭标签
      depth--;
      if (depth === 0) {
        return nextClose;
      }
      pos = nextClose + 1;
    }
  }

  return -1;
}

/**
 * 处理单个块（each 或 if）
 */
function processBlock(html, data, localData = null) {
  let result = '';
  let pos = 0;

  while (pos < html.length) {
    // 查找下一个 {{
    const nextBrace = html.indexOf('{{', pos);

    if (nextBrace === -1) {
      // 没有更多模板语法了
      result += html.slice(pos);
      break;
    }

    // 添加到 {{
    result += html.slice(pos, nextBrace);

    // 检查是什么类型的块
    const rest = html.slice(nextBrace);

    if (rest.startsWith('{{#each ')) {
      // 找到 each 块
      const pathEnd = html.indexOf('}}', nextBrace);
      if (pathEnd === -1) {
        result += html.slice(nextBrace);
        break;
      }

      const path = html.slice(nextBrace + 8, pathEnd).trim();
      const contentStart = pathEnd + 2;

      // 找到配对的 {{/each}}
      const endPos = findMatchingEnd(html, contentStart, 'each');

      if (endPos === -1) {
        // 没有找到关闭标签
        result += html.slice(nextBrace);
        break;
      }

      const content = html.slice(contentStart, endPos);

      // 获取数据
      let items;
      if (path.startsWith('this.')) {
        items = getValue(path, data, localData);
      } else {
        items = getValue(path, data);
      }

      if (Array.isArray(items) && items.length > 0) {
        // 处理每个 item
        const rendered = items.map((item, index) => {
          let processed = content;
          // 递归处理内容中的嵌套块
          processed = processBlock(processed, data, item);

          // 替换 {{this}}（如果是简单值）
          if (typeof item === 'string' || typeof item === 'number') {
            processed = processed.replace(/\{\{this\}\}/g, () => escapeHTML(item));
          }

          // 替换 {{this.xxx}}
          processed = processed.replace(/\{\{this\.([^}]+)\}\}/g, (m, p) => {
            let current = item;
            for (const key of p.split('.')) {
              if (current === null || current === undefined) return '';
              current = current[key];
            }
            return escapeHTML(current);
          });

          // 替换 {{@index}}
          processed = processed.replace(/\{\{@index\}\}/g, () => escapeHTML(index));

          // 替换其他变量
          processed = processed.replace(/\{\{([^}]+)\}\}/g, (m, p) => {
            if (p.startsWith('#') || p.startsWith('/')) return m;
            return escapeHTML(getValue(p.trim(), data, item));
          });

          return processed;
        });
        result += rendered.join('');
      }
      // 如果 items 为空，什么都不加

      pos = endPos + 9; // 跳过 {{/each}}
    } else if (rest.startsWith('{{#if ')) {
      // 找到 if 块
      const pathEnd = html.indexOf('}}', nextBrace);
      if (pathEnd === -1) {
        result += html.slice(nextBrace);
        break;
      }

      const path = html.slice(nextBrace + 6, pathEnd).trim();
      const contentStart = pathEnd + 2;

      // 找到配对的 {{/if}}
      const endPos = findMatchingEnd(html, contentStart, 'if');

      if (endPos === -1) {
        result += html.slice(nextBrace);
        break;
      }

      const content = html.slice(contentStart, endPos);

      // 分离 if 和 else 部分
      const elseMatch = content.match(/^(.*?)\{\{else\}\}(.*)$/s);
      const ifContent = elseMatch ? elseMatch[1] : content;
      const elseContent = elseMatch ? elseMatch[2] : '';

      // 评估条件
      const conditionMet = getValue(path, data, localData);

      if (conditionMet) {
        // 递归处理 if 内容
        result += processBlock(ifContent, data, localData);
      } else if (elseContent) {
        result += processBlock(elseContent, data, localData);
      }
      // elseContent 为空时不添加任何内容

      pos = endPos + 7; // 跳过 {{/if}}
    } else {
      // 普通变量或未识别的语法
      // 检查是否是三重大括号 {{{variable}}} 表示不转义
      const tripleMatch = rest.match(/^\{\{\{([^}]+)\}\}\}/);
      const doubleMatch = rest.match(/^\{\{([^}]+)\}\}/);

      if (tripleMatch) {
        // 三重大括号，不转义
        const path = tripleMatch[1].trim();
        const value = getValue(path, data, localData);
        result += String(value || '');
        pos = nextBrace + tripleMatch[0].length;
      } else if (doubleMatch) {
        const path = doubleMatch[1].trim();
        if (!path.startsWith('#') && !path.startsWith('/')) {
          const value = getValue(path, data, localData);
          result += escapeHTML(value);
        } else {
          // 未识别的块语法，原样保留
          result += doubleMatch[0];
        }
        pos = nextBrace + doubleMatch[0].length;
      } else {
        // 语法错误，原样保留
        result += html.slice(nextBrace, nextBrace + 2);
        pos = nextBrace + 2;
      }
    }
  }

  return result;
}

/**
 * 主入口
 */
export function fillTemplate(templateHTML, data = {}) {
  if (!templateHTML) {
    throw new Error('模板不能为空');
  }

  if (!data) {
    data = {};
  }

  return processBlock(templateHTML, data);
}

export async function fillTemplateFromFile(templatePath, data) {
  const fs = await import('fs');
  const content = await fs.promises.readFile(templatePath, 'utf-8');
  return fillTemplate(content, data);
}

export async function loadTemplate(templatePath) {
  const fs = await import('fs');
  return fs.promises.readFile(templatePath, 'utf-8');
}

export function loadTemplateSync(templatePath) {
  const fs = require('fs');
  return fs.readFileSync(templatePath, 'utf-8');
}

export async function renderReport(reportData, templatePath) {
  const template = await loadTemplate(templatePath);
  return fillTemplate(template, reportData);
}

export function getNestedValue(obj, path) {
  return getValue(path, obj);
}

export function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  const lastKey = keys.pop();
  let current = obj;

  for (const key of keys) {
    if (!current[key]) {
      current[key] = {};
    }
    current = current[key];
  }

  current[lastKey] = value;
}

export default {
  fillTemplate,
  fillTemplateFromFile,
  loadTemplate,
  loadTemplateSync,
  renderReport,
  getNestedValue,
  setNestedValue
};
