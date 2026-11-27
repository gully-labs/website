// Tabulator wrapper for dense tables: sticky header, virtual scroll (when a height is given), sortable columns, number
// columns right-aligned in the numeric font. Cells are built as DOM nodes (textContent), never HTML strings.
//   const h = await mountTable(el, { columns: [{ title: 'Coin', field: 'name' }, { title: 'MC', field: 'mc', kind: 'usd' }],
//                                    data, height: 420, empty: 'No coins yet' })
//   kinds: text | usd | num | pct | addr (short 0x1234…abcd, full value in the title) | thin (USD + Thin chip under $500)
//   h.set(rows) ; h.update(rows) (by id) ; h.destroy()
import { lazy, css, frame, fmtUsd, fmtNum, fmtPct, thinChip, THIN_USD, el as mk } from './core.js';

const short = (a) => (typeof a === 'string' && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a ?? '');
/** cell node for a kind (pure DOM, tested in the browser suite) */
export function cellNode(kind, v, row) {
  if (kind === 'usd') return mk('span', 'gu-num', fmtUsd(v));
  if (kind === 'num') return mk('span', 'gu-num', fmtNum(v));
  if (kind === 'pct') { const s = mk('span', 'gu-num ' + (v > 0 ? 'gu-up' : v < 0 ? 'gu-down' : ''), fmtPct(v)); return s; }
  if (kind === 'addr') { const s = mk('span', 'gu-addr', short(v)); s.title = v ?? ''; return s; }
  if (kind === 'thin') { const s = mk('span', 'gu-num', fmtUsd(v)); const liq = row && row.liquidityUsd; if (liq != null && liq < THIN_USD) { s.append(' ', thinChip(liq)); } return s; }
  return mk('span', null, v == null ? '' : String(v));
}
const NUMERIC = new Set(['usd', 'num', 'pct', 'thin']);

export async function mountTable(host, spec) {
  css('./vendor/tabulator.css');
  const plot = frame(host, 'loading');
  const { Tabulator } = await lazy('tabulator');
  const rows = spec.data || [];
  const columns = spec.columns.map((c) => ({
    title: c.title, field: c.field, headerSort: c.sort !== false, frozen: !!c.frozen, minWidth: c.minWidth || (NUMERIC.has(c.kind) ? 96 : 120), widthGrow: c.grow,
    hozAlign: NUMERIC.has(c.kind) ? 'right' : 'left', headerHozAlign: NUMERIC.has(c.kind) ? 'right' : 'left',
    sorter: NUMERIC.has(c.kind) ? 'number' : 'string',
    formatter: (cell) => cellNode(c.kind || 'text', cell.getValue(), cell.getRow().getData()),
  }));
  const placeholder = mk('div', 'gu-note', spec.empty || 'No rows yet');
  const table = new Tabulator(plot, {
    data: rows, columns, layout: 'fitColumns', index: spec.index || 'id', placeholder,
    height: spec.height || undefined, renderVertical: spec.height ? 'virtual' : 'basic',
    movableColumns: false, selectableRows: false,
  });
  await new Promise((r) => table.on('tableBuilt', r));
  frame(host, 'ready');
  host.classList.add('gu-table');
  return {
    get table() { return table; },
    set(next) { return table.replaceData(next); },
    update(next) { return table.updateOrAddData(next); },
    destroy() { table.destroy(); },
  };
}
