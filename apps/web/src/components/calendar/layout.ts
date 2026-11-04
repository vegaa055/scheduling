/**
 * Lays out overlapping events in a day column. Events that overlap (transitively) form a
 * cluster; each gets a column within the cluster and stretches right into free columns.
 */
export interface Box<T> {
  item: T;
  col: number;
  cols: number;
  span: number;
}

export function layoutColumn<T extends { s: number; e: number }>(items: T[]): Box<T>[] {
  const sorted = [...items].sort((a, b) => a.s - b.s || b.e - b.s - (a.e - a.s));
  const out: Box<T>[] = [];
  let cluster: { item: T; col: number }[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const cols = colEnds.length;
    for (const c of cluster) {
      let span = 1;
      while (
        c.col + span < cols &&
        !cluster.some((o) => o.col === c.col + span && o.item.s < c.item.e && c.item.s < o.item.e)
      ) {
        span++;
      }
      out.push({ item: c.item, col: c.col, cols, span });
    }
    cluster = [];
    colEnds = [];
    clusterEnd = -Infinity;
  };

  for (const it of sorted) {
    if (cluster.length && it.s >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= it.s);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(it.e);
    } else {
      colEnds[col] = it.e;
    }
    cluster.push({ item: it, col });
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  flush();
  return out;
}
