const BOM = "﻿";

/**
 * 極簡 CSV 產生器：跳脫逗號/引號/換行，並加上 UTF-8 BOM 前綴
 * （見 SPEC.md §10.5「支援排序與 CSV 匯出（UTF-8 BOM，Excel 可直開）」），
 * 不為此另外引入外部套件。
 */
function escapeCsvField(value: string | number): string {
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvField).join(","));
  return BOM + lines.join("\r\n") + "\r\n";
}
