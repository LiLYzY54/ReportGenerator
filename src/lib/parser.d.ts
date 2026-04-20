export interface ParseResult {
  metadata: { student: any };
  records: any[];
}
export function parseExcel(file: File): Promise<ParseResult>;
