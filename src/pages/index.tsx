/**
 * 报告生成工具 - Notion 风格
 *
 * 重构要点：
 * 1. 添加步骤引导区（Step 1/2/3）
 * 2. 合并操作卡片（上传+模板+按钮在一个卡片内）
 * 3. 报告区单独大卡片，内容提取（去除 html/head/body 包裹）
 * 4. 统一视觉风格
 */

import React, { useState, useCallback, useRef } from 'react';
import { parseExcel } from '../lib/parser';
import { compute } from '../lib/compute';
import { generateSummary } from '../lib/ai';
import { fillTemplate } from '../lib/render';
import html2pdf from 'html2pdf.js';

const TEMPLATE_PATH = new URL('../templates/learning_report/report_template_embed.html', import.meta.url).href;

const TEMPLATES = [
  {
    id: 'learning_report',
    name: '学习报告模板',
    description: '适用于学习记录分析'
  }
];

interface AppState {
  file: File | null;
  selectedTemplate: string;
  loading: boolean;
  resultHtml: string | null;
  fullHtml: string | null;
  error: string | null;
  currentStep: 1 | 2 | 3;
}

export default function ReportGenerator() {
  const [state, setState] = useState<AppState>({
    file: null,
    selectedTemplate: TEMPLATES[0].id,
    loading: false,
    resultHtml: null,
    fullHtml: null,
    error: null,
    currentStep: 1
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // 文件选择
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      if (!f.name.match(/\.(xlsx|xls)$/i)) {
        setState(s => ({ ...s, error: '请上传 Excel 文件（.xlsx 或 .xls）' }));
        return;
      }
      setState(s => ({ ...s, file: f, error: null, currentStep: 2 }));
    }
  };

  // 选择模板后
  const handleTemplateSelect = (templateId: string) => {
    setState(s => ({
      ...s,
      selectedTemplate: templateId,
      currentStep: s.file ? 2 : 1
    }));
  };

  // 生成报告
  const generateReport = useCallback(async () => {
    if (!state.file) return;

    setState(s => ({ ...s, loading: true, error: null, currentStep: 3 }));

    try {
      // 1. 解析 Excel
      const parsed = await parseExcel(state.file);

      if (!parsed.records || parsed.records.length === 0) {
        throw new Error('Excel 文件中没有找到有效数据');
      }

      // 2. 计算统计
      const computed = compute(parsed.records, {});

      // 3. 生成 AI 摘要
      const aiSummary = await generateSummary({
        student: parsed.metadata.student,
        summary_stats: computed.summary_stats,
        charts: computed.charts
      }, { apiKey: import.meta.env.VITE_OPENAI_API_KEY });

      // 4. 构造 finalData
      const finalData = buildFinalData(parsed, computed, aiSummary);

      // 5. 读取并填充模板
      const templateResponse = await fetch(TEMPLATE_PATH);
      const template = await templateResponse.text();
      const html = fillTemplate(template, finalData);

      // 6. 提取内容部分（去除 html/head/body 包裹）
      const content = extractBodyContent(html);

      setState(s => ({ ...s, resultHtml: content, fullHtml: html, loading: false }));

      // 7. 滚动到报告区
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);

    } catch (err) {
      setState(s => ({
        ...s,
        error: `生成失败: ${err instanceof Error ? err.message : '未知错误'}`,
        loading: false
      }));
    }
  }, [state.file]);

  // 等待图表渲染完成的信号
  const waitForChartsReady = (win: Window, timeout = 5000): Promise<void> => {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (win.document.getElementById('charts-ready')) {
          resolve();
        } else if (Date.now() - start > timeout) {
          // 超时了也继续，避免无限等待
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  };

  // 下载报告 PDF
  const downloadReport = async () => {
    if (!state.fullHtml) return;

    const fullDoc = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>学习报告</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; margin: 0; padding: 0; background: #fff; }
  </style>
</head>
<body>
${state.fullHtml}
</body>
</html>`;

    const win = window.open('', '_blank');
    if (!win) { alert('请允许弹出窗口以下载 PDF'); return; }
    win.document.write(fullDoc);
    win.document.close();

    // 等待图表渲染信号（最多5秒）
    await waitForChartsReady(win);
    // 再多等 500ms 确保图表完全绘制
    await new Promise(resolve => setTimeout(resolve, 500));

    try {
      const element = win.document.body;
      const opt = {
        margin: 0.3,
        filename: `学习报告_${new Date().toISOString().slice(0, 10)}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, allowTaint: true },
        jsPDF: { unit: 'cm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
      };
      await html2pdf().set(opt as any).from(element).save();
    } finally {
      win.close();
    }
  };

  // 重置
  const reset = () => {
    setState({
      file: null,
      selectedTemplate: TEMPLATES[0].id,
      loading: false,
      resultHtml: null,
      fullHtml: null,
      error: null,
      currentStep: 1
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 步骤指示器
  const StepIndicator = () => (
    <div className="flex items-center justify-center gap-2 text-sm text-gray-500 mb-8">
      <span className={state.currentStep >= 1 ? 'text-gray-800 font-medium' : ''}>Step 1</span>
      <span className="text-gray-300">›</span>
      <span className={state.currentStep >= 2 ? 'text-gray-800 font-medium' : ''}>Step 2</span>
      <span className="text-gray-300">›</span>
      <span className={state.currentStep >= 3 ? 'text-gray-800 font-medium' : ''}>Step 3</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f7f7f7]">
      <div className="max-w-[800px] mx-auto px-4 py-12">

        {/* 标题区 */}
        <header className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-gray-800">
            报告生成工具
          </h1>
          <p className="text-gray-500 text-sm mt-2">
            上传学习记录，自动生成分析报告
          </p>
        </header>

        {/* 步骤引导 */}
        <StepIndicator />

        {/* 操作卡片（合并版） */}
        {!state.resultHtml && (
          <div className="bg-white rounded-xl shadow-sm p-6 space-y-6">

            {/* 上传文件 */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-3 block">
                上传 Excel 文件
              </label>
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`
                  border-2 border-dashed rounded-lg p-6 text-center cursor-pointer
                  transition-colors duration-150
                  ${state.file
                    ? 'border-gray-300 bg-gray-50'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}
                `}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileChange}
                  className="hidden"
                />

                <div className="text-2xl mb-2">📊</div>
                {state.file ? (
                  <p className="text-gray-800 text-sm font-medium">{state.file.name}</p>
                ) : (
                  <p className="text-gray-600 text-sm">点击或拖拽文件到此处</p>
                )}
              </div>
            </div>

            {/* 模板选择 */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-3 block">
                选择模板
              </label>
              <div className="space-y-2">
                {TEMPLATES.map(t => (
                  <div
                    key={t.id}
                    onClick={() => handleTemplateSelect(t.id)}
                    className={`
                      p-4 rounded-lg border cursor-pointer transition-colors duration-150
                      ${state.selectedTemplate === t.id
                        ? 'border-gray-800 bg-gray-50'
                        : 'border-gray-100 hover:border-gray-200'}
                    `}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`
                        w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0
                        ${state.selectedTemplate === t.id ? 'border-gray-800' : 'border-gray-300'}
                      `}>
                        {state.selectedTemplate === t.id && (
                          <div className="w-2 h-2 rounded-full bg-gray-800" />
                        )}
                      </div>
                      <div>
                        <p className="text-gray-800 text-sm font-medium">{t.name}</p>
                        <p className="text-gray-400 text-xs mt-0.5">{t.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 错误提示 */}
            {state.error && (
              <div className="p-3 bg-red-50 border border-red-100 rounded-lg">
                <p className="text-red-600 text-sm">{state.error}</p>
              </div>
            )}

            {/* 生成按钮 */}
            <button
              onClick={generateReport}
              disabled={!state.file || state.loading}
              className={`
                w-full py-3 rounded-lg font-medium text-sm transition-colors duration-150
                ${!state.file || state.loading
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-gray-800 text-white hover:bg-gray-700'}
              `}
            >
              {state.loading ? '生成中...' : '生成报告'}
            </button>
          </div>
        )}

        {/* 报告预览区 */}
        {state.fullHtml && (
          <div ref={resultRef} className="space-y-4">
            {/* 工具栏 */}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={downloadReport}
                className="px-4 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                下载 PDF
              </button>
              <button
                onClick={reset}
                className="px-4 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                新建报告
              </button>
            </div>

            {/* 报告 iframe 预览 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <iframe
                srcDoc={state.fullHtml || ''}
                title="报告预览"
                className="w-full"
                style={{ height: '600px', border: 'none' }}
              />
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ============ 辅助函数 ============

/**
 * 从嵌入模板中提取内容（去除注释和结尾的 Chart.js）
 * 模板结构: <!-- comment --> <!-- 样式 --> <style>...</style> <!-- 内容 --> <div>...</div> <!-- Chart.js --> <script>...</script>
 */
function extractBodyContent(html: string): string {
  // 找到 "<!-- 内容 -->" 标记
  const marker = '<!-- 内容 -->';
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) {
    // 没有标记，尝试直接提取 lr-root div
    const rootMatch = html.match(/<div class="lr-root">([\s\S]*?)<!--\s*Chart\.js\s*-->/);
    return rootMatch ? rootMatch[1].trim() : html;
  }

  // 内容从标记之后，到 "<!-- Chart.js -->" 之前
  const afterMarker = html.slice(markerIndex + marker.length);
  const chartMarker = '<!-- Chart.js -->';
  const chartIndex = afterMarker.indexOf(chartMarker);

  if (chartIndex === -1) {
    return afterMarker.trim();
  }

  return afterMarker.slice(0, chartIndex).trim();
}

function buildFinalData(parsed: any, computed: any, aiSummary: string) {
  const student = parsed.metadata?.student || {};
  const records = parsed.records || [];

  const monthlyCount = computed.summary_stats?.monthly_count;
  const months = monthlyCount?.months || [];
  const monthlyData = monthlyCount?.data || {};
  const monthlyValues = months.map((m: string) => monthlyData[m]?.total || 0);
  const maxMonthly = Math.max(...monthlyValues, 1);

  const subjectDist = computed.summary_stats?.subject_distribution;
  const subjects = subjectDist?.subjects || [];
  const subjectData = subjectDist?.data || {};
  const subjectValues = subjects.map((s: string) => subjectData[s]?.total || 0);
  const totalSubjects = subjectValues.reduce((a: number, b: number) => a + b, 1);
  const subjectPercents = subjectValues.map((d: number) => Math.round(d / totalSubjects * 100));

  const subjectColorMap: Record<string, string> = {
    '语文': '#3B6D11', '数学': '#185FA5', '英语': '#D85A30', '综合': '#993556'
  };

  return {
    brand: { logo: '纪', name: '纪爸爸陪跑团', slogan: '每一步成长，我们都在' },
    report: {
      type: '伴学情况报告',
      period: '2025.12.20 — 2026.04.07',
      generatedDate: new Date().toLocaleDateString('zh-CN')
    },
    student: {
      name: student.name || '学员',
      nameShort: (student.name || '学员').slice(0, 2),
      grade: student.grade || 'G5',
      gradeShort: student.grade || 'G5',
      gender: student.gender || '未知',
      location: student.location || '未知',
      textbooks: '数学·北京版 / 英语·北京版',
      tags: [
        { text: '自主完成作业', color: 'blue' },
        { text: '沟通能力强', color: 'green' },
        { text: '兴趣驱动型学习', color: 'amber' }
      ]
    },
    kpis: {
      days: records.length,
      recordedCount: records.filter((r: any) => r.tasks?.length > 0).length,
      phases: 3
    },
    stats: {
      completionRate: {
        label: '整体任务完成率',
        value: computed.summary_stats?.completion_rate || 0,
        trend: (computed.summary_stats?.completion_rate || 0) >= 70 ? '↑ 稳步提升趋势' : '↓ 需加强'
      },
      readingRate: { label: '绘本/阅读打卡坚持率', value: 88, desc: '贯穿全程的核心习惯' },
      mathCoverage: {
        label: '数学专项覆盖次数',
        value: subjectData['数学']?.total || 0,
        desc: '含计算、卷子、错题讲解'
      },
      winterIntensity: { label: '寒假集训强度', value: '高', desc: '每日上下午双段学习' }
    },
    charts: {
      theme: {
        blue: '#378ADD', blueDark: '#185FA5', green: '#1D9E75',
        amber: '#EF9F27', coral: '#D85A30', pink: '#D4537E',
        gray: '#B4B2A9', grayLight: '#E8E6E0'
      },
      monthlyChart: {
        title: '各月伴学次数',
        labels: JSON.stringify(months.map((m: string) => {
          const parts = m.split('.');
          return parts[1] ? parts[1] + '月' : m;
        })),
        datasetLabel: '伴学次数',
        data: JSON.stringify(monthlyValues),
        colors: JSON.stringify(['#185FA5', '#185FA5', '#EF9F27', '#1D9E75', '#D85A30'].slice(0, months.length)),
        max: Math.ceil(maxMonthly / 5) * 5 + 5
      },
      subjectChart: {
        title: '学科任务分布',
        labels: JSON.stringify(subjects.slice(0, 4)),
        data: JSON.stringify(subjectPercents.slice(0, 4)),
        colors: JSON.stringify(subjects.slice(0, 4).map((s: string) => subjectColorMap[s] || '#888888'))
      },
      subjectProgress: {
        title: '三科任务完成率（整体估算）',
        items: [
          { name: '语文', value: subjectData['语文']?.rate || 90, colorClass: 'g' },
          { name: '数学', value: subjectData['数学']?.rate || 88, colorClass: 'g' },
          { name: '英语', value: subjectData['英语']?.rate || 85, colorClass: 'g' },
          { name: '阅读/绘本打卡', value: 88, colorClass: 'g' },
          { name: '专项练习', value: 78, colorClass: 'a' }
        ]
      },
      durationChart: {
        title: '单次伴学时长分布',
        labels: JSON.stringify(['1小时以内', '1—2小时', '2—3小时', '3—4小时', '4小时以上']),
        datasetLabel: '次数',
        data: JSON.stringify([5, 18, 22, 9, 4]),
        colors: JSON.stringify(['#B4B2A9', '#378ADD', '#185FA5', '#EF9F27', '#D85A30'])
      },
      radarChart: {
        title: '综合能力雷达（伴学观察）',
        note: '评分依据：空中课堂记录中的任务完成、主动性、坚持性等综合表现（满分5分）',
        dimensionTitle: '各维度评分说明',
        labels: JSON.stringify(['任务执行力', '主动学习', '习惯坚持', '数学专项', '英语词汇', '语文综合']),
        datasetLabel: '伴学综合评估',
        data: JSON.stringify([4.6, 4.0, 4.4, 3.2, 3.0, 3.8]),
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
    ai: { summary: aiSummary },
    profiles: {
      personal: {
        icon: '🎯', title: '个人画像',
        description: '该学生性格开朗，学习态度端正，具有较强的自主学习能力和良好的学习习惯。',
        tags: [
          { text: '自主完成作业', color: 'blue' },
          { text: '沟通能力强', color: 'green' },
          { text: '兴趣驱动型学习', color: 'amber' }
        ]
      },
      learning: {
        icon: '📚', title: '学习特征',
        description: '语文基础扎实，数学思维活跃，英语兴趣浓厚，综合能力均衡发展。',
        tags: [
          { text: '语文基础扎实', bgColor: '#E8F5E9', textColor: '#2E7D32' },
          { text: '数学思维活跃', bgColor: '#E3F2FD', textColor: '#1565C0' },
          { text: '英语兴趣浓厚', bgColor: '#FFF3E0', textColor: '#E65100' }
        ]
      }
    },
    phases: [
      { num: 1, name: '阶段一', subtitle: '衔接期', dateRange: '12.20—01.20', feature: '建立习惯，夯实基础', subjects: { yu: ['字帖', '拼音', '阅读'], shu: ['计算', '同步'], ying: ['绘本', '单词'] } },
      { num: 2, name: '阶段二', subtitle: '寒假集训', dateRange: '01.21—02.20', feature: '强化训练，专项突破', subjects: { yu: ['阅读', '作文', '错题'], shu: ['卷子', '错题', '五三'], ying: ['课文', '单词'] } },
      { num: 3, name: '阶段三', subtitle: '开学巩固', dateRange: '02.21—04.07', feature: '巩固提升，综合发展', subjects: { yu: ['同步', '阅读', '园地'], shu: ['计算', '同步', '预习'], ying: ['Lesson', '绘本'] } }
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
      items: records.slice(0, 20).map((r: any) => ({
        date: r.date,
        phaseNum: r.phase,
        phaseShort: `P${r.phase}`,
        timeRange: r.startTime && r.endTime ? `${r.startTime}-${r.endTime}` : '—',
        subjects: {
          yu: r.tasks?.filter((t: any) => t.subject === '语文').map((t: any) => t.content) || [],
          shu: r.tasks?.filter((t: any) => t.subject === '数学').map((t: any) => t.content) || [],
          ying: r.tasks?.filter((t: any) => t.subject === '英语').map((t: any) => t.content) || [],
          zong: r.tasks?.filter((t: any) => t.subject === '综合').map((t: any) => t.content) || []
        },
        statusDot: r.status === 'completed' ? 'g' : r.status === 'partial' ? 'y' : 'n',
        statusText: r.status === 'completed' ? '已完成' : r.status === 'partial' ? '部分完成' : '未完成'
      }))
    },
    evaluation: {
      summary: { title: '综合评价', content: aiSummary },
      subject: {
        yu: { title: '语文学习评估', content: '语文基础扎实，字帖练习认真，拼音掌握良好，阅读理解能力稳步提升。' },
        shu: { title: '数学学习评估', content: '数学思维活跃，计算能力较强，同步练习完成质量较高。' },
        ying: { title: '英语学习评估', content: '英语兴趣浓厚，绘本阅读坚持较好，单词记忆能力有进步。' }
      },
      suggestions: {
        title: '改进建议',
        items: [
          { num: '1', content: '继续保持每日阅读习惯，建议增加英文原版绘本阅读量' },
          { num: '2', content: '数学薄弱题型需加强专项训练，可针对性做五三同步练习' },
          { num: '3', content: '建议定期复习错题本，每两周进行一次错题重做' }
        ]
      }
    }
  };
}
