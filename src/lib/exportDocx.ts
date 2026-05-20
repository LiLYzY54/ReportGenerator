import { 
  Document, 
  Packer, 
  Paragraph, 
  TextRun, 
  Table, 
  TableRow, 
  TableCell, 
  WidthType, 
  BorderStyle, 
  AlignmentType, 
  HeadingLevel,
  ImageRun,
  VerticalAlign,
  ShadingType
} from 'docx';
import { saveAs } from 'file-saver';

/**
 * 将报告数据导出为 Word 文档 (docx)
 * @param data 报告完整数据
 * @param filename 导出文件名
 * @param chartImages 图表图片数据 (base64)
 */
export async function exportToDocx(data: any, filename: string, chartImages: Record<string, string> = {}) {
  // 辅助：将 base64 转为 Uint8Array
  const base64ToUint8Array = (base64: string) => {
    const binaryString = window.atob(base64.split(',')[1]);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  };

  const sections: any[] = [];

  // --- 第1页：总览 ---
  sections.push({
    children: [
      // 品牌页眉
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: data.brand.name, bold: true, size: 40, color: 'C41E3A' }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 300 },
        children: [
          new TextRun({ text: `${data.report.type} | 周期：${data.report.period}`, size: 20, color: '666666' }),
        ],
      }),

      // 学生信息条
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                shading: { fill: 'F1EFE8', type: ShadingType.CLEAR },
                margins: { top: 200, bottom: 200, left: 200, right: 200 },
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({ text: data.student.name, bold: true, size: 32 }),
                      new TextRun({ text: `  ${data.student.grade} | ${data.student.location} | 教材：${data.student.textbooks}`, size: 22, color: '666666' }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),

      new Paragraph({ spacing: { before: 300 } }),

      // 核心 KPI
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              createStatCell('任务完成率', data.stats.completionRate.value + '%', data.stats.completionRate.trend),
              createStatCell('阅读坚持率', data.stats.readingRate.value + '%', data.stats.readingRate.desc),
              createStatCell('数学覆盖次数', data.stats.mathCoverage.value.toString(), data.stats.mathCoverage.desc),
            ],
          }),
        ],
      }),

      new Paragraph({ 
        text: "一、本周任务分布", 
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 } 
      }),
      // 插入月度/周任务分布图
      ...(chartImages.monthChart ? [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              data: base64ToUint8Array(chartImages.monthChart),
              transformation: { width: 500, height: 200 },
            } as any),
          ],
        }),
      ] : [new Paragraph({ text: "[图表数据加载中...]" })]),

      new Paragraph({ 
        text: "二、学科任务分布", 
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 } 
      }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
          left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
          insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE },
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 50, type: WidthType.PERCENTAGE },
                children: chartImages.subjectChart ? [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                      new ImageRun({
                        data: base64ToUint8Array(chartImages.subjectChart),
                        transformation: { width: 200, height: 200 },
                      } as any),
                    ],
                  }),
                ] : [],
              }),
              new TableCell({
                width: { size: 50, type: WidthType.PERCENTAGE },
                verticalAlign: VerticalAlign.CENTER,
                children: data.charts.subjectProgress.items.map((item: any) => 
                  new Paragraph({
                    children: [
                      new TextRun({ text: `● ${item.name}: `, bold: true, size: 24 }),
                      new TextRun({ text: `${item.value}% 完成度`, size: 24, color: item.colorClass === 'g' ? '1D9E75' : 'EF9F27' }),
                    ],
                  })
                ),
              }),
            ],
          }),
        ],
      }),
    ],
  });

  // --- 第2页：明细与评价 ---
  sections.push({
    children: [
      new Paragraph({ 
        text: "三、能力雷达与综合评价", 
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 200 } 
      }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
          left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
          insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE },
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 50, type: WidthType.PERCENTAGE },
                children: chartImages.radarChart ? [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                      new ImageRun({
                        data: base64ToUint8Array(chartImages.radarChart),
                        transformation: { width: 250, height: 250 },
                      } as any),
                    ],
                  }),
                ] : [],
              }),
              new TableCell({
                width: { size: 50, type: WidthType.PERCENTAGE },
                verticalAlign: VerticalAlign.CENTER,
                shading: { fill: 'FEF2F2', type: ShadingType.CLEAR },
                margins: { left: 200, right: 200 },
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: "导师综合建议：", bold: true, size: 24, color: 'C41E3A' })],
                  }),
                  new Paragraph({
                    spacing: { before: 100 },
                    children: [new TextRun({ text: data.evaluation.summary.content, size: 22 })],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),

      new Paragraph({ 
        text: "四、伴学记录明细", 
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 } 
      }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: [
              createHeaderCell('日期', 15),
              createHeaderCell('时间段', 20),
              createHeaderCell('核心记录内容', 50),
              createHeaderCell('状态', 15),
            ],
          }),
          ...data.records.items.map((item: any) => {
            const contentText = [
              item.subjects.yu.length ? `[语] ${item.subjects.yu.join('; ')}` : '',
              item.subjects.shu.length ? `[数] ${item.subjects.shu.join('; ')}` : '',
              item.subjects.ying.length ? `[英] ${item.subjects.ying.join('; ')}` : '',
              item.subjects.zong.length ? `[综] ${item.subjects.zong.join('; ')}` : ''
            ].filter(Boolean).join('\n');
            
            return new TableRow({
              children: [
                createCell(item.date),
                createCell(item.timeRange),
                createCell(contentText),
                createCell(item.statusText),
              ],
            });
          }),
        ],
      }),

      new Paragraph({ 
        text: "五、改进建议", 
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 } 
      }),
      ...data.evaluation.suggestions.items.map((s: any) => 
        new Paragraph({
          indent: { left: 400 },
          spacing: { before: 100 },
          children: [
            new TextRun({ text: `${s.num}. `, bold: true, color: '185FA5' }),
            new TextRun({ text: s.content.replace(/<[^>]+>/g, ''), size: 24 }),
          ],
        })
      ),
    ],
  });

  // 2. 创建文档并导出
  const doc = new Document({
    sections: sections.map(s => ({ properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } }, children: s.children })),
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${filename}.docx`);
}

function createStatCell(label: string, val: string, sub: string) {
  return new TableCell({
    shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
    margins: { top: 150, bottom: 150, left: 100, right: 100 },
    children: [
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: label, size: 18, color: '666666' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: val, size: 36, bold: true, color: '185FA5' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: sub, size: 16, color: '888888' })] }),
    ],
  });
}

function createHeaderCell(text: string, widthPct: number) {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    shading: { fill: '334155', type: ShadingType.CLEAR },
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text, color: 'FFFFFF', bold: true, size: 22 })] }),
    ],
  });
}

function createCell(text: string) {
  return new TableCell({
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 100, bottom: 100, left: 100, right: 100 },
    children: [
      new Paragraph({ children: [new TextRun({ text, size: 20 })] }),
    ],
  });
}
