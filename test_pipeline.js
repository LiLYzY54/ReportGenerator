/**
 * 测试流程：Excel → Parser → Compute → AI → Render
 * 验证完整数据链路
 */

import { parseExcelFile } from './src/lib/parser.js';
import { compute } from './src/lib/compute.js';
import { generateSummary } from './src/lib/ai.js';
import { fillTemplate } from './src/lib/render.js';
import fs from 'fs';
import path from 'path';

const EXCEL_PATH = '../伴学周报/学习情况记录.xlsx';
const TEMPLATE_PATH = '../HTML模板/伴学报告_冯敬壹_template.html';
const OUTPUT_PATH = './test_output.html';

async function main() {
  console.log('=== 步骤1: 读取 Excel ===');
  const parsed = await parseExcelFile(EXCEL_PATH);
  console.log(`记录数: ${parsed.records.length}`);
  console.log(`元数据: ${JSON.stringify(parsed.metadata)}`);

  console.log('\n=== 步骤2: 调用 parseExcel ===');
  const records = parsed.records;
  console.log(`解析记录数: ${records.length}`);
  console.log('第一条记录:', JSON.stringify(records[0], null, 2));

  console.log('\n=== 步骤3: 调用 compute ===');
  // 使用内置默认配置
  const computed = compute(records, {});
  console.log('统计结果:');
  console.log('- 完成率:', computed.summary_stats.completion_rate + '%');
  console.log('- 总任务:', computed.summary_stats.completion_total);
  console.log('- 已完成:', computed.summary_stats.completion_completed);
  console.log('- 月份:', computed.summary_stats.monthly_count?.months);
  console.log('- 学科:', computed.summary_stats.subject_distribution?.subjects);

  console.log('\n=== 步骤4: 调用 AI 生成摘要 ===');
  const aiData = {
    student: parsed.metadata.student,
    summary_stats: computed.summary_stats,
    charts: computed.charts
  };
  // apiKey 从环境变量读取，失败时自动 fallback
  const aiSummary = await generateSummary(aiData, {
    apiKey: process.env.OPENAI_API_KEY
  });
  console.log('AI 摘要:', aiSummary);

  console.log('\n=== 步骤5: 构造 finalData ===');
  const finalData = {
    brand: {
      logo: '纪',
      name: '纪爸爸陪跑团',
      slogan: '每一步成长，我们都在'
    },
    report: {
      type: '伴学情况报告',
      period: '2025.12.20 — 2026.04.07',
      generatedDate: new Date().toLocaleDateString('zh-CN')
    },
    student: {
      name: parsed.metadata.student?.name || '测试用户',
      nameShort: (parsed.metadata.student?.name || '测试用户').slice(0, 2),
      grade: parsed.metadata.student?.grade || 'G5',
      gradeShort: parsed.metadata.student?.grade || 'G5',
      gender: parsed.metadata.student?.gender || '未知',
      location: parsed.metadata.student?.location || '未知',
      textbooks: '数学·北京版 / 英语·北京版',
      tags: [
        { text: '自主完成作业', color: 'blue' },
        { text: '沟通能力强', color: 'green' },
        { text: '兴趣驱动型学习', color: 'amber' },
        { text: '大考发挥待稳定', color: 'coral' },
        { text: '家长全力配合', color: 'blue' }
      ]
    },
    kpis: {
      days: records.length,
      recordedCount: records.filter(r => r.tasks && r.tasks.length > 0).length,
      phases: 3
    },
    stats: {
      completionRate: {
        label: '整体任务完成率',
        value: computed.summary_stats.completion_rate,
        trend: computed.summary_stats.completion_rate >= 70 ? '↑ 稳步提升趋势' : '↓ 需加强'
      },
      readingRate: {
        label: '绘本/阅读打卡坚持率',
        value: 88,
        desc: '贯穿全程的核心习惯'
      },
      mathCoverage: {
        label: '数学专项覆盖次数',
        value: computed.summary_stats.subject_distribution?.data?.['数学']?.total || 0,
        desc: '含计算、卷子、错题讲解'
      },
      winterIntensity: {
        label: '寒假集训强度',
        value: '高',
        desc: '每日上下午双段学习'
      }
    },
    charts: {
      theme: {
        blue: '#378ADD',
        blueDark: '#185FA5',
        green: '#1D9E75',
        amber: '#EF9F27',
        coral: '#D85A30',
        pink: '#D4537E',
        gray: '#B4B2A9',
        grayLight: '#E8E6E0'
      },
      monthlyChart: buildMonthlyChart(computed.summary_stats.monthly_count),
      subjectChart: buildSubjectChart(computed.summary_stats.subject_distribution),
      subjectProgress: buildSubjectProgress(computed.summary_stats.subject_distribution),
      durationChart: {
        title: '单次伴学时长分布',
        labels: ['1小时以内', '1—2小时', '2—3小时', '3—4小时', '4小时以上'],
        datasetLabel: '次数',
        data: [5, 18, 22, 9, 4],
        colors: ['#B4B2A9', '#378ADD', '#185FA5', '#EF9F27', '#D85A30']
      },
      radarChart: {
        title: '综合能力雷达（伴学观察）',
        note: '评分依据：空中课堂记录中的任务完成、主动性、坚持性等综合表现（满分5分）',
        dimensionTitle: '各维度评分说明',
        labels: ['任务执行力', '主动学习', '习惯坚持', '数学专项', '英语词汇', '语文综合'],
        datasetLabel: '伴学综合评估',
        data: [4.6, 4.0, 4.4, 3.2, 3.0, 3.8],
        bgColor: 'rgba(24,95,165,0.12)',
        dimensions: [
          { name: '任务执行力', score: '4.6', percent: 92, colorClass: 'g' },
          { name: '学习主动性', score: '4.0', percent: 80, colorClass: 'g' },
          { name: '习惯坚持性（阅读打卡）', score: '4.4', percent: 88, colorClass: 'g' },
          { name: '数学专项突破', score: '3.2', percent: 64, colorClass: 'a' },
          { name: '英语词汇积累', score: '3.0', percent: 60, colorClass: 'a' },
          { name: '语文综合表现', score: '3.8', percent: 76, colorClass: 'g' }
        ]
      }
    },
    summary_stats: computed.summary_stats,
    ai: {
      summary: aiSummary
    },
    profiles: {
      personal: {
        icon: '🎯',
        title: '个人画像',
        description: '该学生性格开朗，学习态度端正，具有较强的自主学习能力和良好的学习习惯。',
        tags: [
          { text: '自主完成作业', color: 'blue' },
          { text: '沟通能力强', color: 'green' },
          { text: '兴趣驱动型学习', color: 'amber' }
        ]
      },
      learning: {
        icon: '📚',
        title: '学习特征',
        description: '语文基础扎实，数学思维活跃，英语兴趣浓厚，综合能力均衡发展。',
        tags: [
          { text: '语文基础扎实', bgColor: '#E8F5E9', textColor: '#2E7D32' },
          { text: '数学思维活跃', bgColor: '#E3F2FD', textColor: '#1565C0' },
          { text: '英语兴趣浓厚', bgColor: '#FFF3E0', textColor: '#E65100' },
          { text: '综合能力均衡', bgColor: '#F3E5F5', textColor: '#7B1FA2' }
        ]
      }
    },
    phases: [
      {
        num: 1,
        name: '阶段一',
        subtitle: '衔接期',
        dateRange: '12.20—01.20',
        feature: '建立习惯，夯实基础',
        subjects: {
          yu: ['字帖', '拼音', '阅读'],
          shu: ['计算', '同步'],
          ying: ['绘本', '单词']
        }
      },
      {
        num: 2,
        name: '阶段二',
        subtitle: '寒假集训',
        dateRange: '01.21—02.20',
        feature: '强化训练，专项突破',
        subjects: {
          yu: ['阅读', '作文', '错题'],
          shu: ['卷子', '错题', '五三'],
          ying: ['课文', '单词']
        }
      },
      {
        num: 3,
        name: '阶段三',
        subtitle: '开学巩固',
        dateRange: '02.21—04.07',
        feature: '巩固提升，综合发展',
        subjects: {
          yu: ['同步', '阅读', '园地'],
          shu: ['计算', '同步', '预习'],
          ying: ['Lesson', '绘本']
        }
      }
    ],
    footer: {
      dataSource: '数据来源：伴学记录Excel',
      pageInfo: '第 1 页 / 共 3 页',
      completionNote: '完成率统计基于实际记录',
      pageInfo2: '第 2 页 / 共 3 页',
      reportNote: '综合评价由AI辅助生成',
      pageInfo3: '第 3 页 / 共 3 页'
    },
    records: {
      title: '伴学记录明细',
      items: records.slice(0, 20).map(r => ({
        date: r.date,
        phaseNum: r.phase,
        phaseShort: `P${r.phase}`,
        timeRange: r.startTime && r.endTime ? `${r.startTime}-${r.endTime}` : '—',
        subjects: {
          yu: r.tasks?.filter(t => t.subject === '语文').map(t => t.content) || [],
          shu: r.tasks?.filter(t => t.subject === '数学').map(t => t.content) || [],
          ying: r.tasks?.filter(t => t.subject === '英语').map(t => t.content) || [],
          zong: r.tasks?.filter(t => t.subject === '综合').map(t => t.content) || []
        },
        statusDot: r.status === 'completed' ? 'g' : r.status === 'partial' ? 'y' : 'n',
        statusText: r.status === 'completed' ? '已完成' : r.status === 'partial' ? '部分完成' : '未完成'
      }))
    },
    evaluation: {
      summary: {
        title: '综合评价',
        content: aiSummary
      },
      subject: {
        yu: {
          title: '语文学习评估',
          content: '语文基础扎实，字帖练习认真，拼音掌握良好，阅读理解能力稳步提升。作文方面有进步空间，建议加强日常写作练习。'
        },
        shu: {
          title: '数学学习评估',
          content: '数学思维活跃，计算能力较强，同步练习完成质量较高。错题整理及时，但部分题型需要加强专项训练。'
        },
        ying: {
          title: '英语学习评估',
          content: '英语兴趣浓厚，绘本阅读坚持较好，单词记忆能力有进步。课文跟读认真，建议加强口语表达练习。'
        }
      },
      suggestions: {
        title: '改进建议',
        items: [
          { num: '1', content: '继续保持每日阅读习惯，建议增加英文原版绘本阅读量' },
          { num: '2', content: '数学薄弱题型需加强专项训练，可针对性做五三同步练习' },
          { num: '3', content: '建议定期复习错题本，每两周进行一次错题重做' },
          { num: '4', content: '加强语文作文练习，每周完成一篇小作文' }
        ]
      }
    }
  };

  console.log('\n=== 步骤6: 读取 template.html ===');
  let template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  console.log(`模板长度: ${template.length} 字符`);

  console.log('\n=== 步骤7: 调用 render ===');
  try {
    const html = fillTemplate(template, finalData);
    console.log(`渲染成功! HTML长度: ${html.length} 字符`);

    // 保存输出
    fs.writeFileSync(OUTPUT_PATH, html, 'utf-8');
    console.log(`\n已保存到: ${OUTPUT_PATH}`);

    console.log('\n=== 验证 ===');
    verifyOutput(html, finalData);

    return html;
  } catch (error) {
    console.error('渲染失败:', error.message);
    console.error(error.stack);
    return null;
  }
}

function buildMonthlyChart(monthlyCount) {
  if (!monthlyCount || !monthlyCount.months) {
    return {
      title: '各月伴学次数',
      labels: ['12月', '1月', '2月', '3月', '4月'],
      datasetLabel: '伴学次数',
      data: [0, 0, 0, 0, 0],
      colors: ['#185FA5', '#185FA5', '#EF9F27', '#1D9E75', '#D85A30'],
      max: 20
    };
  }

  const months = monthlyCount.months.map(m => {
    const parts = m.split('.');
    return parts[1] ? parts[1] + '月' : m;
  });

  const data = monthlyCount.months.map(m => monthlyCount.data[m]?.total || 0);
  const max = Math.max(...data, 1);

  return {
    title: '各月伴学次数',
    labels: months,
    datasetLabel: '伴学次数',
    data,
    colors: ['#185FA5', '#185FA5', '#EF9F27', '#1D9E75', '#D85A30'].slice(0, months.length),
    max: Math.ceil(max / 5) * 5 + 5
  };
}

function buildSubjectChart(subjectDist) {
  if (!subjectDist || !subjectDist.subjects) {
    return {
      title: '学科任务分布',
      labels: ['语文', '数学', '英语', '综合'],
      data: [25, 30, 25, 20],
      colors: ['#3B6D11', '#185FA5', '#D85A30', '#993556']
    };
  }

  const subjects = subjectDist.subjects.slice(0, 4);
  const data = subjects.map(s => subjectDist.data[s]?.total || 0);
  const total = data.reduce((a, b) => a + b, 1);
  const percentages = data.map(d => Math.round(d / total * 100));

  const colorMap = {
    '语文': '#3B6D11',
    '数学': '#185FA5',
    '英语': '#D85A30',
    '综合': '#993556'
  };

  return {
    title: '学科任务分布',
    labels: subjects,
    data: percentages,
    colors: subjects.map(s => colorMap[s] || '#888888')
  };
}

function buildSubjectProgress(subjectDist) {
  if (!subjectDist || !subjectDist.subjects) {
    return {
      title: '三科任务完成率（整体估算）',
      items: [
        { name: '语文', value: 90, colorClass: 'g' },
        { name: '数学', value: 88, colorClass: 'g' },
        { name: '英语', value: 85, colorClass: 'g' },
        { name: '阅读/绘本打卡', value: 88, colorClass: 'g' },
        { name: '专项练习', value: 78, colorClass: 'a' }
      ]
    };
  }

  const getRate = (subject) => {
    const data = subjectDist.data?.[subject];
    return data?.rate || 0;
  };

  return {
    title: '三科任务完成率（整体估算）',
    items: [
      { name: '语文', value: getRate('语文') || 90, colorClass: 'g' },
      { name: '数学', value: getRate('数学') || 88, colorClass: 'g' },
      { name: '英语', value: getRate('英语') || 85, colorClass: 'g' },
      { name: '阅读/绘本打卡', value: 88, colorClass: 'g' },
      { name: '专项练习（卷子·错题·专题）', value: 78, colorClass: 'a' }
    ]
  };
}

function verifyOutput(html, data) {
  console.log('\n--- 验证结果 ---');

  // 检查关键变量是否被替换
  const checks = [
    { name: '学生姓名', pattern: data.student.name },
    { name: '完成率', pattern: data.stats.completionRate.value + '%' },
    { name: 'KPI天数', pattern: data.kpis.days.toString() },
    { name: '图表数据', pattern: data.charts.monthlyChart.data.join(',') },
  ];

  for (const check of checks) {
    const found = html.includes(check.pattern);
    console.log(`${found ? '✓' : '✗'} ${check.name}: ${check.pattern}`);
  }

  // 检查是否有残留的 {{}}
  const remaining = html.match(/\{\{[^}]+\}\}/g);
  if (remaining) {
    console.log(`\n⚠️ 发现 ${remaining.length} 个未替换的变量:`);
    remaining.slice(0, 5).forEach(v => console.log('  ', v));
  } else {
    console.log('\n✓ 所有变量已替换');
  }

  // 检查HTML结构
  console.log('\n--- HTML结构检查 ---');
  console.log(`${html.includes('<html') ? '✓' : '✗'} 包含 <html>`);
  console.log(`${html.includes('<div class="page"') ? '✓' : '✗'} 包含页面div`);
  console.log(`${html.includes('<canvas id="monthChart"') ? '✓' : '✗'} 包含月度图表canvas`);
  console.log(`${html.includes('<canvas id="radarChart"') ? '✓' : '✗'} 包含雷达图canvas`);
}

main().catch(console.error);
