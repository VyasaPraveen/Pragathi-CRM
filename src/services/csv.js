// One CSV writer for every export button. Excel opens it straight away: the
// BOM marks it as UTF-8, and a cell with a comma, quote or line break is quoted.
export function csvText(headers, rows) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [headers.join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
}

export function downloadCSV(filename, headers, rows) {
  const blob = new Blob(['﻿' + csvText(headers, rows)], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

// The roles that may download the Materials and Stock History exports (Req 2, 4-Nov).
export const EXPORT_ROLES = ['super_admin', 'operation_manager', 'management', 'admin'];
export const canExportData = (role) => EXPORT_ROLES.includes(role);
