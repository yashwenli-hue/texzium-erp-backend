// Reading a snapshot back. A snapshot is JSON, so dates are ISO strings and a column
// that is null is null. Restoring needs the original row: exactly the named columns,
// with the date columns turned back into Dates. Anything else in the snapshot (an
// included relation, a field added later) is left out on purpose, so a restore can
// only write columns it was written to know about.

type Row = Record<string, unknown>;

export function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function rowsOf(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(isRow) : [];
}

// `keys` are the columns to take; `dates` the ones among them that are dates.
export function reviveRow(
  row: Row,
  keys: readonly string[],
  dates: readonly string[],
): Row {
  const out: Row = {};

  for (const key of keys) {
    if (!(key in row)) {
      continue;
    }

    const value = row[key];

    out[key] =
      dates.includes(key) && typeof value === 'string'
        ? new Date(value)
        : value;
  }

  return out;
}

export function idsOf(rows: Row[]): string[] {
  return rows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === 'string');
}

export function uniqueStrings(values: unknown[]): string[] {
  return [
    ...new Set(
      values.filter((v): v is string => typeof v === 'string' && v !== ''),
    ),
  ];
}
