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
import { filterRecordsByRange, getWeekRange, getFullRange, formatDateRange, parseDateToObject } from '../lib/filter';
import { exportToDocx } from '../lib/exportDocx';

const TEMPLATE_PATHS: Record<string, string> = {
  'full': '/ReportGenerator/templates/learning_report/report_template_embed.html',
  'weekly': '/ReportGenerator/templates/learning_report/report_template_weekly.html'
};

const TEMPLATES = [
  {
    id: 'full',
    name: '全局报告',
    description: '完整阶段数据，含学习阶段概览'
  },
  {
    id: 'weekly',
    name: '周报',
    description: '当周数据，简洁版'
  }
];

interface AppState {
  file: File | null;
  selectedTemplate: string;
  loading: boolean;
  resultHtml: string | null;
  fullHtml: string | null;
  reportData: any | null;
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
    reportData: null,
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

      // 2. 根据模板类型过滤数据
      let filteredRecords;
      let dateRange;

      if (state.selectedTemplate === 'weekly') {
        // 周报：基于记录中的最新日期计算所在周
        let maxDate = new Date(0);
        for (const r of parsed.records) {
          const d = parseDateToObject(r.date);
          if (d && d > maxDate) maxDate = d;
        }

        // 如果没有找到有效日期，才使用当前日期
        dateRange = getWeekRange(maxDate.getTime() === 0 ? new Date() : maxDate);
        filteredRecords = filterRecordsByRange(parsed.records, dateRange.start, dateRange.end);
      } else {
        // 全局报告：使用全量数据
        dateRange = getFullRange(parsed.records);
        filteredRecords = parsed.records;
      }

      // 3. 计算统计（基于过滤后的数据）
      const computed = compute(filteredRecords, {});

      // 4. 生成 AI 摘要 (全自动使用环境变量中配置的 Key)
      const aiSummary = await generateSummary({
        student: parsed.metadata.student,
        summary_stats: computed.summary_stats,
        records: filteredRecords
      });

      // 5. 构造 finalData
      const finalData = buildFinalData(
        { ...parsed, records: filteredRecords },
        computed,
        aiSummary,
        dateRange,
        state.selectedTemplate
      );

      // 6. 读取并填充模板
      const templatePath = TEMPLATE_PATHS[state.selectedTemplate] || TEMPLATE_PATHS['full'];
      const templateResponse = await fetch(templatePath);
      const template = await templateResponse.text();
      const html = fillTemplate(template, finalData);

      // 7. 提取内容部分
      const content = extractBodyContent(html);

      setState(s => ({ 
        ...s, 
        resultHtml: content, 
        fullHtml: html, 
        reportData: finalData,
        loading: false 
      }));

      // 8. 滚动到报告区
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
  }, [state.file, state.selectedTemplate]);

  // 下载报告 DOCX (纯前端生成)
  const downloadReport = async () => {
    if (!state.reportData) return;

    setState(s => ({ ...s, loading: true }));

    try {
      // 捕获预览 iframe 中的图表图片
      const iframe = document.querySelector('iframe');
      const chartImages: Record<string, string> = {};

      if (iframe && iframe.contentDocument) {
        const ids = ['monthChart', 'subjectChart', 'durationChart', 'radarChart'];
        for (const id of ids) {
          const canvas = iframe.contentDocument.getElementById(id) as HTMLCanvasElement;
          if (canvas) {
            chartImages[id] = canvas.toDataURL('image/png');
          }
        }
      }

      const filename = `学习报告_${state.reportData.student.name}_${new Date().toISOString().slice(0, 10)}`;
      await exportToDocx(state.reportData, filename, chartImages);
    } catch (err) {
      alert(`导出失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setState(s => ({ ...s, loading: false }));
    }
  };

  // 重置
  const reset = () => {
    setState(s => ({
      ...s,
      file: null,
      selectedTemplate: TEMPLATES[0].id,
      loading: false,
      resultHtml: null,
      fullHtml: null,
      reportData: null,
      error: null,
      currentStep: 1
    }));
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
          <h1 className="text-2xl font-semibold text-gray-800">报告生成工具</h1>
          <p className="text-gray-500 text-sm mt-1">自动生成深度学情分析报告</p>
        </header>

        {/* 步骤引导 */}
        <StepIndicator />

        {/* 操作卡片 */}
        {!state.resultHtml && (
          <div className="bg-white rounded-xl shadow-sm p-6 space-y-6">
            {/* 上传文件 */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-3 block">上传 Excel 文件</label>
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${state.file ? 'border-gray-300 bg-gray-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
              >
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFileChange} className="hidden" />
                <div className="text-2xl mb-2">📊</div>
                {state.file ? <p className="text-gray-800 text-sm font-medium">{state.file.name}</p> : <p className="text-gray-600 text-sm">点击或拖拽文件到此处</p>}
              </div>
            </div>

            {/* 模板选择 */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-3 block">选择模板</label>
              <div className="space-y-2">
                {TEMPLATES.map(t => (
                  <div key={t.id} onClick={() => handleTemplateSelect(t.id)} className={`p-4 rounded-lg border cursor-pointer transition-colors ${state.selectedTemplate === t.id ? 'border-gray-800 bg-gray-50' : 'border-gray-100 hover:border-gray-200'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${state.selectedTemplate === t.id ? 'border-gray-800' : 'border-gray-300'}`}>
                        {state.selectedTemplate === t.id && <div className="w-2 h-2 rounded-full bg-gray-800" />}
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
            {state.error && <div className="p-3 bg-red-50 border border-red-100 rounded-lg"><p className="text-red-600 text-sm">{state.error}</p></div>}

            {/* 生成按钮 */}
            <button
              onClick={generateReport}
              disabled={!state.file || state.loading}
              className={`w-full py-3 rounded-lg font-medium text-sm transition-colors ${!state.file || state.loading ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gray-800 text-white hover:bg-gray-700'}`}
            >
              {state.loading ? '生成中...' : '生成报告'}
            </button>
          </div>
        )}

        {/* 报告预览区 */}
        {state.fullHtml && (
          <div ref={resultRef} className="space-y-4">
            <div className="flex items-center justify-end gap-2">
              <button onClick={downloadReport} disabled={state.loading} className="px-4 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                下载报告
              </button>
              <button onClick={reset} className="px-4 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                新建报告
              </button>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <iframe srcDoc={state.fullHtml || ''} title="报告预览" className="w-full" style={{ height: '600px', border: 'none' }} />
            </div>
          </div>
        )}

      </div>
    </div>
  );
}// ============ 辅助函数 ============

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

function buildFinalData(parsed: any, computed: any, aiSummary: string | object, dateRange?: { start: Date; end: Date }, templateType?: string) {
  const student = parsed.metadata?.student || {};
  const records = parsed.records || [];
  const isWeekly = templateType === 'weekly';

  // 周任务统计（周一~周日）- 按学科堆叠
  const weekCountsBySubject: Record<string, number[]> = {
    '语文': [0,0,0,0,0,0,0], '数学': [0,0,0,0,0,0,0], '英语': [0,0,0,0,0,0,0], '综合': [0,0,0,0,0,0,0]
  };
  const dayIndexMap = [6, 0, 1, 2, 3, 4, 5]; // 周日=6, 周一=0, ...
  for (const r of records) {
    const dateObj = parseDateToObject(r.date);
    if (dateObj) {
      const dayIndex = dayIndexMap[dateObj.getDay()];
      for (const t of (r.tasks || [])) {
        const sub = t.subject === '语文' || t.subject === '数学' || t.subject === '英语' ? t.subject : '综合';
        weekCountsBySubject[sub][dayIndex]++;
      }
    }
  }

  const subjectDist = computed.summary_stats?.subject_distribution;
  const subjects = subjectDist?.subjects || [];
  const subjectData = subjectDist?.data || {};
  const subjectValues = subjects.map((s: string) => subjectData[s]?.total || 0);
  const totalSubjects = subjectValues.reduce((a: number, b: number) => a + b, 1);
  const subjectPercents = subjectValues.map((d: number) => Math.round(d / totalSubjects * 100));

  const subjectColorMap: Record<string, string> = {
    '语文': '#3B6D11', '数学': '#185FA5', '英语': '#D85A30', '综合': '#993556'
  };

  // 判断年级是否显示阅读打卡维度（G1-G6显示）
  const gradeNum = parseInt(student.grade?.replace('G', '') || '0');
  const showReadingDimension = gradeNum >= 1 && gradeNum <= 6;

  // 格式化日期范围
  const periodStr = dateRange ? formatDateRange(dateRange.start, dateRange.end) : '全周期';

  // 学习时长分布统计（细化区间）
  const durationBuckets = [0, 0, 0, 0, 0]; // <45m, 45m-1.5h, 1.5h-2h, 2h-3h, >3h
  for (const r of records) {
    const dur = r.duration || 0;
    if (dur > 0 && dur <= 45) durationBuckets[0]++;
    else if (dur > 45 && dur <= 90) durationBuckets[1]++;
    else if (dur > 90 && dur <= 120) durationBuckets[2]++;
    else if (dur > 120 && dur <= 180) durationBuckets[3]++;
    else if (dur > 180) durationBuckets[4]++;
  }

  // 雷达图维度：根据学科完成率动态生成
  const radarDimensions = [];
  const subjectStats = computed.summary_stats?.subjectStats || {};

  // 任务执行力 = 整体完成率
  const overallRate = computed.summary_stats?.completion_rate || 0;
  if (overallRate > 0) {
    radarDimensions.push({
      name: '任务执行力',
      score: (overallRate / 20).toFixed(1),
      percent: overallRate,
      colorClass: overallRate >= 80 ? 'g' : overallRate >= 60 ? 'a' : overallRate >= 40 ? 'c' : 'n'
    });
  }

  // 学科专项（根据实际数据）
  const mathRate = subjectStats.math?.rate || 0;
  if (mathRate > 0) {
    radarDimensions.push({
      name: '数学专项',
      score: (mathRate / 20).toFixed(1),
      percent: mathRate,
      colorClass: mathRate >= 80 ? 'g' : mathRate >= 60 ? 'a' : mathRate >= 40 ? 'c' : 'n'
    });
  }

  const chineseRate = subjectStats.chinese?.rate || 0;
  if (chineseRate > 0) {
    radarDimensions.push({
      name: '语文综合',
      score: (chineseRate / 20).toFixed(1),
      percent: chineseRate,
      colorClass: chineseRate >= 80 ? 'g' : chineseRate >= 60 ? 'a' : chineseRate >= 40 ? 'c' : 'n'
    });
  }

  const englishRate = subjectStats.english?.rate || 0;
  if (englishRate > 0) {
    radarDimensions.push({
      name: '英语词汇',
      score: (englishRate / 20).toFixed(1),
      percent: englishRate,
      colorClass: englishRate >= 80 ? 'g' : englishRate >= 60 ? 'a' : englishRate >= 40 ? 'c' : 'n'
    });
  }

  // 生成雷达图标签和数据
  const radarLabels = radarDimensions.map(d => d.name);
  const radarData = radarDimensions.map(d => parseFloat(d.score));

  return {
    showReadingDimension,
    brand: { logo: '金', name: '北大金秋伴学营', slogan: '每一步成长，我们都在' },
    report: {
      type: isWeekly ? '伴学周报' : '伴学情况报告',
      period: periodStr,
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
      readingRate: { label: '绘本/阅读打卡坚持率', value: computed.summary_stats?.subjectDetails?.['语文'] ? Math.round((subjectData['语文']?.rate || 0) * 0.9) : 88, desc: isWeekly ? '本周继续保持' : '贯穿全程的核心习惯' },
      mathCoverage: {
        label: '数学专项覆盖次数',
        value: subjectData['数学']?.total || 0,
        desc: '含计算、卷子、错题讲解'
      },
      weekIntensity: isWeekly ? { label: '本周学习强度', value: records.length > 10 ? '高' : records.length > 5 ? '中' : '一般', desc: '本周共' + records.length + '次伴学记录' } : null,
      winterIntensity: !isWeekly ? { label: '寒假集训强度', value: '高', desc: '每日上下午双段学习' } : null
    },
    statsNoWinter: isWeekly ? {
      completionRate: {
        label: '整体任务完成率',
        value: computed.summary_stats?.completion_rate || 0,
        trend: (computed.summary_stats?.completion_rate || 0) >= 70 ? '↑ 稳步提升趋势' : '↓ 需加强'
      },
      readingRate: { label: '绘本/阅读打卡坚持率', value: computed.summary_stats?.subjectDetails?.['语文'] ? Math.round((subjectData['语文']?.rate || 0) * 0.9) : 88, desc: '本周继续保持' },
      mathCoverage: {
        label: '数学专项覆盖次数',
        value: subjectData['数学']?.total || 0,
        desc: '含计算、卷子、错题讲解'
      },
      weekIntensity: { label: '本周学习强度', value: records.length > 10 ? '高' : records.length > 5 ? '中' : '一般', desc: '本周共' + records.length + '次伴学记录' }
    } : null,
    charts: {
      theme: {
        blue: '#378ADD', blueDark: '#185FA5', green: '#1D9E75',
        amber: '#EF9F27', coral: '#D85A30', pink: '#D4537E',
        gray: '#B4B2A9', grayLight: '#E8E6E0'
      },
      monthlyChart: {
        title: '本周任务分布（分学科）',
        labels: JSON.stringify(['周一','周二','周三','周四','周五','周六','周日']),
        datasets: JSON.stringify([
          { label: '语文', data: weekCountsBySubject['语文'], backgroundColor: '#3B6D11' },
          { label: '数学', data: weekCountsBySubject['数学'], backgroundColor: '#185FA5' },
          { label: '英语', data: weekCountsBySubject['英语'], backgroundColor: '#D85A30' },
          { label: '综合', data: weekCountsBySubject['综合'], backgroundColor: '#993556' }
        ]),
        max: Math.ceil(Math.max(...Object.values(weekCountsBySubject).flat(), 1) / 5) * 5 + 5
      },
      subjectChart: {
        title: '学科任务分布',
        labels: JSON.stringify(subjects.slice(0, 4)),
        data: JSON.stringify(subjectPercents.slice(0, 4)),
        colors: JSON.stringify(subjects.slice(0, 4).map((s: string) => subjectColorMap[s] || '#888888'))
      },
      subjectProgress: {
        title: '三科任务完成率',
        items: [
          { name: '语文', value: subjectData['语文']?.rate || 0, colorClass: (subjectData['语文']?.rate || 0) >= 80 ? 'g' : (subjectData['语文']?.rate || 0) >= 60 ? 'a' : (subjectData['语文']?.rate || 0) >= 40 ? 'c' : 'n' },
          { name: '数学', value: subjectData['数学']?.rate || 0, colorClass: (subjectData['数学']?.rate || 0) >= 80 ? 'g' : (subjectData['数学']?.rate || 0) >= 60 ? 'a' : (subjectData['数学']?.rate || 0) >= 40 ? 'c' : 'n' },
          { name: '英语', value: subjectData['英语']?.rate || 0, colorClass: (subjectData['英语']?.rate || 0) >= 80 ? 'g' : (subjectData['英语']?.rate || 0) >= 60 ? 'a' : (subjectData['英语']?.rate || 0) >= 40 ? 'c' : 'n' }
        ].filter(item => item.value > 0)
      },
      durationChart: {
        title: '单次伴学时长分布',
        labels: JSON.stringify(['< 45m', '45m—1.5h', '1.5h—2h', '2h—3h', '> 3h']),
        datasetLabel: '次数',
        data: JSON.stringify(durationBuckets),
        colors: JSON.stringify(['#B4B2A9', '#378ADD', '#185FA5', '#EF9F27', '#D85A30'])
      },
      radarChart: {
        title: '综合能力雷达（伴学观察）',
        note: '评分依据：伴学记录中的任务完成、主动性、坚持性等综合表现（满分5分）',
        dimensionTitle: '各维度评分说明',
        labels: JSON.stringify(radarLabels),
        labelsNoReading: JSON.stringify(radarLabels),
        datasetLabel: '伴学综合评估',
        data: JSON.stringify(radarData),
        dataNoReading: JSON.stringify(radarData),
        bgColor: 'rgba(24,95,165,0.12)',
        dimensions: radarDimensions,
        dimensionsNoReading: radarDimensions
      }
    },
    summary_stats: computed.summary_stats,
    ai: {
      summary: (typeof aiSummary === 'string' ? aiSummary : (aiSummary as any).overall) || JSON.stringify(aiSummary)
    },
    profiles: {
      personal: {
        icon: '🎯', title: '个人画像',
        description: (typeof aiSummary === 'string' ? aiSummary : (aiSummary as any).overall ? (aiSummary as any).overall.slice(0, 60) : '数据分析中...'),
        tags: (computed.summary_stats.behaviorTags || []).slice(0, 3).map((tag: string) => ({
          text: tag,
          color: tag.includes('不稳定') ? 'amber' : tag.includes('强') ? 'green' : 'blue'
        }))
      },
      learning: {
        icon: '📚', title: '学习特征',
        description: '基于学习数据分析得出的学科特点',
        tags: [
          { text: computed.summary_stats.weakSubjects?.[0] ? '薄弱：' + computed.summary_stats.weakSubjects[0] : '各科较均衡', bgColor: '#FFF3E0', textColor: '#E65100' },
          { text: computed.summary_stats.strongSubjects?.[0] ? '强项：' + computed.summary_stats.strongSubjects[0] : '待发掘', bgColor: '#E8F5E9', textColor: '#2E7D32' }
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
      summary: {
        title: '综合评价',
        content: typeof aiSummary === 'string' ? aiSummary : ((aiSummary as any).overall || '数据分析中...')
      },
      subjects: (() => {
        const subs = typeof aiSummary === 'string' ? {} : ((aiSummary as any).subjects || {});
        return Object.keys(subs).map(key => ({
          key,
          title: `${key}学习评估`,
          content: subs[key] || '暂无数据'
        }));
      })(),
      suggestions: {
        title: '改进建议',
        items: (typeof aiSummary === 'string' ? [] : ((aiSummary as any).suggestions || [])).map((s: string, i: number) => ({
          num: String(i + 1),
          content: s
        }))
      }
    }
  };
}
