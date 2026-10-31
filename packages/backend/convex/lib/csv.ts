/** Minimal RFC 4180 CSV helpers; these demo exports have no embedded newlines. */

export function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < csv.length; index++) {
    const character = csv[index];
    if (inQuotes) {
      if (character === '"') {
        if (csv[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
    } else if (character === '"') {
      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((candidate) => candidate.some((value) => value.trim() !== ""));
}

export function required(record: Record<string, string>, key: string): string {
  const value = record[key];
  if (!value) throw new Error(`Missing required CSV column value "${key}"`);
  return value;
}

export function requireColumns(header: string[], columns: string[]): void {
  for (const column of columns) {
    if (!header.includes(column)) {
      throw new Error(`CSV is missing the "${column}" column`);
    }
  }
}

export function toRecord(header: string[], row: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [index, column] of header.entries()) {
    record[column] = (row[index] ?? "").trim();
  }
  return record;
}
