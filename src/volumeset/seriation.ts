/**
 * Seriation: order set members so that similar members sit next to each other.
 *
 * Average-linkage agglomerative clustering on (1 - r) distances, followed by
 * optimal leaf ordering (Bar-Joseph, Gifford & Jaakkola, 2001), which flips
 * subtrees to minimise the summed distance between adjacent leaves without
 * changing the tree. Exact; fine for the set sizes a viewer displays (< ~200).
 */

export interface DendrogramNode {
  /** Leaf member index, or -1 for an internal node. */
  leaf: number;
  left: DendrogramNode | null;
  right: DendrogramNode | null;
  /** Merge height (average-linkage distance); 0 for leaves. */
  height: number;
  /** Leaf indices under this node in the final (optimal) order. */
  leaves: number[];
}

/** Average-linkage clustering of a k x k distance matrix (row-major). */
export function averageLinkage(dist: ArrayLike<number>, k: number): DendrogramNode {
  if (k === 0) throw new Error('cannot cluster an empty set');
  let clusters: DendrogramNode[] = [];
  for (let i = 0; i < k; i++) {
    clusters.push({ leaf: i, left: null, right: null, height: 0, leaves: [i] });
  }
  const d = (a: number, b: number): number => {
    const x = dist[a * k + b];
    return Number.isFinite(x) ? x : 2;
  };
  const linkage = (a: DendrogramNode, b: DendrogramNode): number => {
    let s = 0;
    for (const i of a.leaves) for (const j of b.leaves) s += d(i, j);
    return s / (a.leaves.length * b.leaves.length);
  };
  while (clusters.length > 1) {
    let best = Infinity;
    let bi = 0;
    let bj = 1;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const l = linkage(clusters[i], clusters[j]);
        if (l < best) {
          best = l;
          bi = i;
          bj = j;
        }
      }
    }
    const merged: DendrogramNode = {
      leaf: -1,
      left: clusters[bi],
      right: clusters[bj],
      height: best,
      leaves: [...clusters[bi].leaves, ...clusters[bj].leaves],
    };
    clusters = clusters.filter((_, idx) => idx !== bi && idx !== bj);
    clusters.push(merged);
  }
  return clusters[0];
}

/**
 * Optimal leaf ordering. Returns a new tree whose `leaves` arrays reflect the
 * flips that minimise the sum of distances between adjacent leaves.
 */
export function optimalLeafOrder(root: DendrogramNode, dist: ArrayLike<number>, k: number): DendrogramNode {
  const d = (a: number, b: number): number => {
    const x = dist[a * k + b];
    return Number.isFinite(x) ? x : 2;
  };
  // For each node, M(node)[u][w] = min cost of an ordering of node's leaves
  // starting at leaf u and ending at leaf w (u, w under different children).
  type Table = Map<number, Map<number, number>>;
  const memo = new Map<DendrogramNode, Table>();

  const solve = (node: DendrogramNode): Table => {
    const cached = memo.get(node);
    if (cached) return cached;
    const table: Table = new Map();
    if (node.leaf >= 0) {
      table.set(node.leaf, new Map([[node.leaf, 0]]));
      memo.set(node, table);
      return table;
    }
    const L = solve(node.left!);
    const R = solve(node.right!);
    // Orderings: (left reversed-or-not) then (right), or right then left.
    const combine = (A: Table, B: Table): void => {
      for (const [u, endsA] of A) {
        for (const [w, startsB] of invert(B)) {
          let best = Infinity;
          for (const [m, costA] of endsA) {
            for (const [kk, costB] of startsB) {
              const c = costA + d(m, kk) + costB;
              if (c < best) best = c;
            }
          }
          let row = table.get(u);
          if (!row) table.set(u, (row = new Map()));
          const prev = row.get(w);
          if (prev === undefined || best < prev) row.set(w, best);
        }
      }
    };
    combine(L, R);
    combine(R, L);
    memo.set(node, table);
    return table;
  };

  // invert(B): for each end leaf w of B, map of start leaf k -> cost.
  const invert = (B: Table): Map<number, Map<number, number>> => {
    const out = new Map<number, Map<number, number>>();
    for (const [start, ends] of B) {
      for (const [end, cost] of ends) {
        let row = out.get(end);
        if (!row) out.set(end, (row = new Map()));
        row.set(start, cost);
      }
    }
    return out;
  };

  const rootTable = solve(root);
  let best = Infinity;
  let bu = -1;
  let bw = -1;
  for (const [u, ends] of rootTable) {
    for (const [w, c] of ends) {
      if (c < best) {
        best = c;
        bu = u;
        bw = w;
      }
    }
  }

  // Reconstruct: produce the ordered leaves of `node` starting at u, ending at w.
  const build = (node: DendrogramNode, u: number, w: number): DendrogramNode => {
    if (node.leaf >= 0) return { ...node, leaves: [node.leaf] };
    const L = node.left!;
    const R = node.right!;
    const inL = (x: number): boolean => L.leaves.includes(x);
    const [first, second] = inL(u) ? [L, R] : [R, L];
    const T1 = solve(first);
    const T2 = solve(second);
    const target = solve(node).get(u)!.get(w)!;
    for (const [m, c1] of T1.get(u)!) {
      for (const [start, ends] of T2) {
        const c2 = ends.get(w);
        if (c2 === undefined) continue;
        if (Math.abs(c1 + d(m, start) + c2 - target) < 1e-9) {
          const a = build(first, u, m);
          const b = build(second, start, w);
          return { ...node, left: a, right: b, leaves: [...a.leaves, ...b.leaves] };
        }
      }
    }
    throw new Error('optimal leaf ordering reconstruction failed');
  };

  return build(root, bu, bw);
}

/** Convenience: similarity (correlation) matrix -> optimal seriation order + tree. */
export function seriate(similarity: ArrayLike<number>, k: number): { order: number[]; tree: DendrogramNode } {
  const dist = new Float64Array(k * k);
  for (let i = 0; i < k * k; i++) dist[i] = 1 - similarity[i];
  for (let i = 0; i < k; i++) dist[i * k + i] = 0;
  if (k === 1) {
    const leaf: DendrogramNode = { leaf: 0, left: null, right: null, height: 0, leaves: [0] };
    return { order: [0], tree: leaf };
  }
  const tree = optimalLeafOrder(averageLinkage(dist, k), dist, k);
  return { order: tree.leaves, tree };
}

/** Sum of distances between adjacent members of an order (lower = smoother). */
export function pathLength(order: readonly number[], dist: ArrayLike<number>, k: number): number {
  let s = 0;
  for (let i = 1; i < order.length; i++) s += dist[order[i - 1] * k + order[i]];
  return s;
}

/** Cut a dendrogram into k clusters; returns a cluster label (0..k-1) per leaf, numbered in leaf order. */
export function cutTree(tree: DendrogramNode, k: number): Int32Array {
  const n = tree.leaves.length;
  let groups: DendrogramNode[] = [tree];
  while (groups.length < k) {
    // Split the group with the highest merge height.
    let bi = -1;
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].leaf >= 0) continue;
      if (bi < 0 || groups[i].height > groups[bi].height) bi = i;
    }
    if (bi < 0) break;
    const g = groups[bi];
    groups.splice(bi, 1, g.left!, g.right!);
  }
  const labels = new Int32Array(Math.max(n, ...tree.leaves.map((l) => l + 1))).fill(-1);
  // Number clusters by first appearance in the tree's leaf order.
  const order = groups.slice().sort((a, b) => tree.leaves.indexOf(a.leaves[0]) - tree.leaves.indexOf(b.leaves[0]));
  order.forEach((g, c) => g.leaves.forEach((leaf) => (labels[leaf] = c)));
  return labels;
}

export interface ClusterSuggestion {
  /** Number of suggested groups (0 when none). */
  k: number;
  /** Group label per member (0..k-1), or -1 for members left unassigned (outliers / small branches). */
  labels: Int32Array;
  /** Group sizes, in label order. */
  sizes: number[];
  /** Members not assigned to any group. */
  unassigned: number[];
  /** Merge-height gap that supported the cut (0 when none). */
  gap: number;
  /** The largest-gap cut considered, whether accepted or not, for reporting (singletons = members alone in a branch). */
  bestCut: { k: number; sizes: number[]; gap: number; singletons: number[] } | null;
}

/**
 * Suggest subgroups with a largest-gap rule on the average-linkage tree.
 * A cut into k branches is admissible when at least two branches have
 * `minSize` or more members; smaller branches are reported as unassigned
 * (outliers), not as groups. This is a heuristic, not a test: absence of a
 * suggestion is "none suggested", not evidence of homogeneity.
 */
export function suggestClusters(tree: DendrogramNode, maxK = 6, minGap = 0.02, minSize?: number): ClusterSuggestion {
  const n = tree.leaves.length;
  const min = minSize ?? Math.max(2, Math.ceil(n * 0.1));
  const size = Math.max(...tree.leaves) + 1;
  const heights: number[] = [];
  const walk = (node: DendrogramNode): void => {
    if (node.leaf >= 0) return;
    heights.push(node.height);
    walk(node.left!);
    walk(node.right!);
  };
  walk(tree);
  heights.sort((a, b) => b - a);
  const sizesOf = (labels: Int32Array, k: number): number[] => {
    const z = new Array(k).fill(0);
    for (const leaf of tree.leaves) z[labels[leaf]]++;
    return z;
  };
  let best: ClusterSuggestion = { k: 0, labels: new Int32Array(size).fill(-1), sizes: [], unassigned: [], gap: 0, bestCut: null };
  let bestCut: { k: number; sizes: number[]; gap: number; singletons: number[] } | null = null;
  let bestGap = minGap;
  for (let k = 2; k <= Math.min(maxK + 3, heights.length); k++) {
    const gap = heights[k - 2] - heights[k - 1];
    const labels = cutTree(tree, k);
    const sizes = sizesOf(labels, k);
    if (!bestCut || gap > bestCut.gap) {
      const singletons = tree.leaves.filter((leaf) => sizes[labels[leaf]] === 1);
      bestCut = { k, sizes, gap, singletons };
    }
    const big = sizes.map((c, i) => (c >= min ? i : -1)).filter((i) => i >= 0);
    if (big.length < 2 || big.length > maxK || gap <= bestGap) continue;
    // Relabel: big branches become groups 0..g-1 (in leaf order); the rest are unassigned.
    const remap = new Map(big.map((c, i) => [c, i]));
    const out = new Int32Array(size).fill(-1);
    const unassigned: number[] = [];
    for (const leaf of tree.leaves) {
      const g = remap.get(labels[leaf]);
      if (g === undefined) unassigned.push(leaf);
      else out[leaf] = g;
    }
    bestGap = gap;
    best = { k: big.length, labels: out, sizes: big.map((c) => sizes[c]), unassigned, gap, bestCut: null };
  }
  best.bestCut = bestCut;
  return best;
}

/** Number of suggested groups (1 when none is suggested). */
export function chooseClusterCount(tree: DendrogramNode, maxK = 6, minGap = 0.02, minSize?: number): number {
  return Math.max(1, suggestClusters(tree, maxK, minGap, minSize).k);
}
