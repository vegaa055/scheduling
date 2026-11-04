/**
 * Minimal RFC 4180 CSV reading and writing, enough for registrar exports and spreadsheets saved
 * as CSV: quoted fields, doubled quotes, commas and line breaks inside quotes, CRLF or LF line
 * ends and a leading byte-order mark.
 */

export interface CsvRow {
  /** 1-based line number where the row starts. */
  line: number;
  cells: string[];
}

export function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const endRow = () => {
    row.push(field);
    rows.push({ line: rowLine, cells: row });
    row = [];
    field = "";
  };

  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
      line++;
      rowLine = line;
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** Spreadsheet apps run cells that start with these as formulas; a leading apostrophe stops that. */
const FORMULA_START = /^[=+@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
  let s = value == null ? "" : String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export const toCsv = (rows: (string | number | null | undefined)[][]) =>
  rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

/** Undoes the apostrophe that `csvCell` adds in front of formula-like values. */
export const unguard = (s: string) => (s.startsWith("'") && FORMULA_START.test(s.slice(1)) ? s.slice(1) : s);
