# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

教培机构运营工具集，包含：月度报告生成、伴学周报解析、新生入学评估三大模块。

## 依赖

```bash
pip install openpyxl
```

---

## 月度报告自动化

**数据源：** `月度报告/月度总结表.xlsx` + `月度报告/周任务记录表.xlsx`

**模板：** `HTML模板/monthly_report_template.html`

**生成脚本：** `HTML模板/generate_monthly_report.py`

```bash
python generate_monthly_report.py <月度总结表.xlsx> <周任务记录表.xlsx> [输出目录]
```

### 数据映射关系

| HTML 元素 | Excel 数据 |
|-----------|-----------|
| 雷达图 | 月度总结表 Row14-18 列D（评级 A/B/C/D → 100/80/60/40）|
| 目标进度条 | 月度总结表 Row4-6 |
| 每周完成率 | 周任务记录表 Row8-33（✔=1, ✘=0, △=0.5）|
| 状态曲线 | 周任务记录表 Row38-40 |

---

## 伴学周报系统

### 新 Excel 模板生成

**脚本：** `伴学周报/学习情况记录_模板.py`

```bash
python 学习情况记录_模板.py [输出路径]
```

生成 4-sheet Excel：入学信息 / 伴学记录 / 错题收集 / 快速统计

### 金山文档解析

**脚本：** `伴学周报/parse_kinsoso.py`

**数据源：** 金山文档 Excel（学员总表 + 每个学生独立 sheet）

```bash
python parse_kinsoso.py <Excel路径> [Sheet名称]
# 默认解析: 冯敬壹G5
```

**填写规范：** `伴学周报/金山文档填写规范.md`

核心规范：
- 日期格式：`YYYY.MM.DD`
- 任务格式：`【学科】任务描述`
- 完成状态：`✅` / `△` / 留空

---

## 新生入学评估系统

**入口：** `HTML模板/StuConTest.html`（直接在浏览器打开）

- **幼儿阶段（3-6岁）**：5 维度观察量表 + 4 个动画互动任务（记忆/排序/情绪/舒尔特方块）
- **小学阶段（7-12岁）**：5 维度纯观察量表打分

每项 1-3 分（需支持/发展中/表现较好），互动任务按尝试次数和用时评分。完成后可导出 PDF 报告。

---

## 目录结构

```
HTML模板/
  StuConTest.html              # 新生入学评估（浏览器直接用）
  monthly_report_template.html # 月度报告 HTML 模板
  generate_monthly_report.py   # 月度报告生成脚本

月度报告/
  月度总结表.xlsx               # 月度数据源
  周任务记录表.xlsx             # 周任务数据源

伴学周报/
  学习情况记录_模板.py          # Excel 模板生成
  学习情况记录_模板.xlsx        # 生成的新模板
  parse_kinsoso.py             # 金山文档解析
  金山文档填写规范.md           # 填写规范文档
```

---

## 技术栈

- **前端**：HTML + Tailwind CSS (CDN) + Chart.js + html2pdf.js
- **数据处理**：Python + openpyxl
- **无构建工具**：直接浏览器打开 HTML 或 `python script.py` 运行
