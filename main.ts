// Sokoban solver: push-optimal per room, then stitched together.
//
// Every generated level is one hallway plus 1-4 small rooms (3-4 boxes each).
// A box pushed out of a room can never come back, so each room is solved on
// its own from the door and the rooms' push counts add up to the level's
// optimum. Per room this runs A* over pushes (not steps): a state is the
// sorted box squares plus the player's reachable region, the cost is pushes,
// and the estimate is the cheapest assignment of boxes to goals by shortest
// floor distance, which never overestimates (one push moves one box one
// square). Dead squares (a box there can never reach a goal) and frozen 2x2
// blocks are pruned. All budgets are fixed node counts, never the clock, so
// two runs write identical bytes.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Fixed work budgets: no clock is read anywhere, so runs are deterministic.
const ROOM_STATES = 400_000;
const GLOBAL_STATES = 300_000;

const DX = [0, 0, -1, 1];
const DY = [-1, 1, 0, 0];
const STEP = ['u', 'd', 'l', 'r'];
const PUSH = ['U', 'D', 'L', 'R'];

type Board = {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
};

function parseLevel(text: string): Board {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
  }
  boxes.sort((a, b) => a - b);
  return { w, h, wall, goals, boxes, player };
}

// Squares a box can ever be pushed from onto a goal, found by pulling back
// from the goals: a square y is live when a box there can be drawn to a live
// square x, which needs the player to stand on the far side (y - d) of it.
function liveSquares(b: Board): Uint8Array {
  const { w, wall, goals } = b;
  const live = new Uint8Array(wall.length);
  const queue = [...goals];
  for (const g of goals) live[g] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi];
    for (let k = 0; k < 4; k++) {
      const d = DY[k] * w + DX[k];
      const y = x - d;
      if (y < 0 || y >= wall.length) continue;
      if (!wall[y] && !wall[y - d] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

// Shortest floor distances between every pair of squares (ignoring boxes),
// by BFS from each floor square. A push moves a box one floor square, so
// this distance never overestimates the pushes a box still needs.
function floorDistances(b: Board): Int32Array {
  const { w, wall } = b;
  const n = wall.length;
  const dist = new Int32Array(n * n).fill(-1);
  const q = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (wall[s]) continue;
    let qh = 0;
    let qt = 0;
    q[qt++] = s;
    dist[s * n + s] = 0;
    while (qh < qt) {
      const p = q[qh++];
      const pd = dist[s * n + p];
      for (let k = 0; k < 4; k++) {
        const nb = p + DY[k] * w + DX[k];
        if (wall[nb] || dist[s * n + nb] !== -1) continue;
        dist[s * n + nb] = pd + 1;
        q[qt++] = nb;
      }
    }
  }
  return dist;
}

// Cheapest assignment of boxes to goals by floor distance, over all
// permutations (at most 4 boxes, so 24). Admissible: each push moves one
// box one square, so the true remaining pushes are at least this sum.
function allPerms(m: number): number[][] {
  const out: number[][] = [];
  const a = Array.from({ length: m }, (_, i) => i);
  const rec = (i: number): void => {
    if (i === m) {
      out.push(a.slice());
      return;
    }
    for (let j = i; j < m; j++) {
      [a[i], a[j]] = [a[j], a[i]];
      rec(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
  };
  rec(0);
  return out;
}

function assignmentHeuristic(
  boxes: number[],
  goals: number[],
  dist: Int32Array,
  n: number,
  perms: number[][],
): number {
  let best = Infinity;
  for (const perm of perms) {
    let sum = 0;
    for (let i = 0; i < boxes.length; i++) {
      const d = dist[boxes[i] * n + goals[perm[i]]];
      if (d < 0) {
        sum = Infinity;
        break;
      }
      sum += d;
      if (sum >= best) break;
    }
    if (sum < best) best = sum;
  }
  return best === Infinity ? 1e9 : best;
}

type SearchCtx = {
  w: number;
  wall: Uint8Array;
  goals: number[];
  goalSet: Uint8Array;
  live: Uint8Array;
  dist: Int32Array;
  n: number;
  seen: Int32Array;
  mark: Int32Array;
  stack: Int32Array;
  stamp: number;
  markStamp: number;
};

// Flood the player's reachable region from `from` with `occupied` in the
// way; returns its lowest square. Uses `mark`/`markStamp`, a separate
// marking from the expansion region's `seen`, so computing a child's region
// never clobbers the parent's region marks.
function regionLow(ctx: SearchCtx, occupied: Uint8Array, from: number): number {
  const { w, wall, mark, stack } = ctx;
  const stamp = ++ctx.markStamp;
  let low = from;
  let sp = 0;
  stack[sp++] = from;
  mark[from] = stamp;
  while (sp > 0) {
    const p = stack[--sp];
    if (p < low) low = p;
    for (let k = 0; k < 4; k++) {
      const q = p + DY[k] * w + DX[k];
      if (!wall[q] && !occupied[q] && mark[q] !== stamp) {
        mark[q] = stamp;
        stack[sp++] = q;
      }
    }
  }
  return low;
}

// Whether the box just pushed to `t` is stuck in a 2x2 block of walls and
// boxes with a box off its goal. Only blocks holding `t` can be new.
function frozenAt(ctx: SearchCtx, occupied: Uint8Array, t: number): boolean {
  const { w, wall, goalSet } = ctx;
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b2 = a + 1;
    const c = a + w;
    const d = c + 1;
    if (a < 0 || d >= wall.length) continue;
    if (!(wall[a] || occupied[a])) continue;
    if (!(wall[b2] || occupied[b2])) continue;
    if (!(wall[c] || occupied[c])) continue;
    if (!(wall[d] || occupied[d])) continue;
    if (
      (occupied[a] && !goalSet[a]) ||
      (occupied[b2] && !goalSet[b2]) ||
      (occupied[c] && !goalSet[c]) ||
      (occupied[d] && !goalSet[d])
    ) {
      return true;
    }
  }
  return false;
}

// A* over pushes for one board. Returns the pushes (box square before the
// push, direction 0-3) of the optimal path when weight is 1, or null when
// the state budget runs out. `weight` > 1 trades optimality for speed
// (used only as a fallback).
function pushSearch(
  b: Board,
  maxStates: number,
  weight: number,
): { box: number; dir: number }[] | null {
  const { w, wall, goals, boxes, player } = b;
  const n = wall.length;
  const goalSet = new Uint8Array(n);
  for (const g of goals) goalSet[g] = 1;
  const live = liveSquares(b);
  if (boxes.some((x) => !live[x])) return null;
  const dist = floorDistances(b);
  const perms = allPerms(boxes.length);
  const ctx: SearchCtx = {
    w,
    wall,
    goals,
    goalSet,
    live,
    dist,
    n,
    seen: new Int32Array(n),
    mark: new Int32Array(n),
    stack: new Int32Array(n),
    stamp: 0,
    markStamp: 0,
  };
  const occupied = new Uint8Array(n);
  for (const x of boxes) occupied[x] = 1;

  const keyOf = (bs: number[], low: number): number | string => {
    if (n ** (bs.length + 1) < 2 ** 53) {
      let k = low;
      for (const x of bs) k = k * n + x;
      return k;
    }
    return low + ':' + bs.join(',');
  };

  // State arrays: boxes, player square after the push, parent, pushed box,
  // push direction, g, heuristic, boxes on goal.
  const sBoxes: number[][] = [boxes.slice()];
  const sPlayer: number[] = [player];
  const sParent: number[] = [-1];
  const sBox: number[] = [-1];
  const sDir: number[] = [-1];
  const sG: number[] = [0];
  const sH: number[] = [assignmentHeuristic(boxes, goals, dist, n, perms)];
  const sOnGoal: number[] = [boxes.reduce((a, x) => a + (goalSet[x] ? 1 : 0), 0)];
  const best = new Map<number | string, number>();
  best.set(keyOf(boxes, regionLow(ctx, occupied, player)), 0);

  // Binary heap on (f, -boxes on goal, -g, sequence): deterministic order.
  const heap: number[] = [];
  const heapVal = (i: number): number => {
    const s = heap[i];
    return (
      (sG[s] + weight * sH[s]) * 1e12 +
      (10 - sOnGoal[s]) * 1e9 +
      (1000 - sG[s]) * 1e6 +
      s
    );
  };
  const heapPush = (s: number): void => {
    let i = heap.length;
    heap.push(s);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapVal(i) >= heapVal(p)) break;
      const t = heap[i];
      heap[i] = heap[p];
      heap[p] = t;
      i = p;
    }
  };
  const heapPop = (): number => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heapVal(c + 1) < heapVal(c)) c++;
        if (heapVal(c) >= heapVal(i)) break;
        const t = heap[i];
        heap[i] = heap[c];
        heap[c] = t;
        i = c;
      }
    }
    return top;
  };
  heapPush(0);

  const solved = (bs: number[]): boolean => bs.every((x) => goalSet[x]);
  if (solved(boxes)) return [];


  while (heap.length > 0) {
    const s = heapPop();
    const bs = sBoxes[s];
    const g = sG[s];
    for (const x of bs) occupied[x] = 1;
    // Stale-entry check: the key must be recomputed with this state's own
    // boxes as obstacles, exactly as it was when the state was recorded.
    if (best.get(keyOf(bs, regionLow(ctx, occupied, sPlayer[s]))) !== s) {
      for (const x of bs) occupied[x] = 0;
      continue;
    }
    if (solved(bs)) {
      const pushes: { box: number; dir: number }[] = [];
      for (let t = s; t > 0; t = sParent[t]) {
        pushes.push({ box: sBox[t], dir: sDir[t] });
      }
      pushes.reverse();
      for (const x of bs) occupied[x] = 0;
      return pushes;
    }
    const stamp = ++ctx.stamp;
    // Mark this state's region in `seen` with `stamp`.
    {
      const { seen, stack } = ctx;
      let sp = 0;
      stack[sp++] = sPlayer[s];
      seen[sPlayer[s]] = stamp;
      while (sp > 0) {
        const p = stack[--sp];
        for (let k = 0; k < 4; k++) {
          const q = p + DY[k] * w + DX[k];
          if (!wall[q] && !occupied[q] && seen[q] !== stamp) {
            seen[q] = stamp;
            stack[sp++] = q;
          }
        }
      }
    }
    for (let bi = 0; bi < bs.length; bi++) {
      const box = bs[bi];
      for (let k = 0; k < 4; k++) {
        const d = DY[k] * w + DX[k];
        const src = box - d;
        const dst = box + d;
        if (ctx.seen[src] !== stamp) continue;
        if (wall[dst] || occupied[dst] || !live[dst]) continue;
        occupied[box] = 0;
        occupied[dst] = 1;
        const frozen = frozenAt(ctx, occupied, dst);
        let key: number | string = -1;
        let next: number[] | null = null;
        let h = 0;
        if (!frozen) {
          next = bs.slice();
          next[bi] = dst;
          next.sort((a, b2) => a - b2);
          const low = regionLow(ctx, occupied, box);
          key = keyOf(next, low);
          const prev = best.get(key);
          if (prev === undefined || sG[prev] > g + 1) {
            h = assignmentHeuristic(next, goals, dist, n, perms);
          } else {
            next = null;
          }
        }
        occupied[dst] = 0;
        occupied[box] = 1;
        if (!next) continue;
        if (sBoxes.length >= maxStates) {
          for (const x of bs) occupied[x] = 0;
          return null;
        }
        best.set(key, sBoxes.length);
        sBoxes.push(next);
        sPlayer.push(box);
        sParent.push(s);
        sBox.push(box);
        sDir.push(k);
        sG.push(g + 1);
        sH.push(h);
        sOnGoal.push(
          sOnGoal[s] - (goalSet[box] ? 1 : 0) + (goalSet[dst] ? 1 : 0),
        );
        heapPush(sBoxes.length - 1);
      }
    }
    for (const x of bs) occupied[x] = 0;
  }
  return null;
}

// Shortest player walk from `from` to `to` around walls and boxes, as
// lower-case steps. Deterministic: u, d, l, r order, first direction first.
function walkTo(b: Board, occupied: Uint8Array, from: number, to: number): string {
  if (from === to) return '';
  const { w, wall } = b;
  const prev = new Int32Array(wall.length).fill(-1);
  const how = new Array<string>(wall.length);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    if (p === to) break;
    for (let k = 0; k < 4; k++) {
      const q = p + DY[k] * w + DX[k];
      if (wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = STEP[k];
      queue.push(q);
    }
  }
  if (prev[to] === -1) throw new Error('walkTo: push square out of reach');
  let s = '';
  for (let p = to; p !== from; p = prev[p]) s = how[p] + s;
  return s;
}

// Turn a push list into a move string on board `b`: walk to each push
// square, then push. The pushed box is named by the search, so there is no
// guessing which box a push moves.
function movesFor(
  b: Board,
  pushes: { box: number; dir: number }[],
): string {
  const { w, boxes, player } = b;
  const occupied = new Uint8Array(w * b.h);
  let curBoxes = boxes.slice();
  for (const x of curBoxes) occupied[x] = 1;
  let curPlayer = player;
  let moves = '';
  for (const { box, dir: k } of pushes) {
    const d = DY[k] * w + DX[k];
    moves += walkTo(b, occupied, curPlayer, box - d);
    moves += PUSH[k];
    occupied[box] = 0;
    occupied[box + d] = 1;
    curBoxes = curBoxes.map((x) => (x === box ? box + d : x));
    curBoxes.sort((a, c) => a - c);
    curPlayer = box;
  }
  return moves;
}

type Room = { boxes: number[]; goals: number[]; done: boolean };

// Split the level into rooms: cut the hallway's dead squares (floor on the
// player's row no box can ever reach a goal from) out of the floor; each
// remaining component holding boxes is a room. Null when the level is not a
// clean set of rooms.
function roomsOf(level: Board): Room[] | null {
  const { w, wall, goals, boxes, player } = level;
  const live = liveSquares(level);
  const row = Math.floor(player / w);
  const cut = new Uint8Array(wall.length);
  for (let i = row * w; i < (row + 1) * w; i++) {
    if (!wall[i] && !live[i]) cut[i] = 1;
  }
  if (boxes.some((x) => cut[x])) return null;
  const part = new Int32Array(wall.length).fill(-1);
  const rooms: Room[] = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (let k = 0; k < 4; k++) {
        const q = squares[i] + DY[k] * w + DX[k];
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ boxes: [], goals: [], done: false });
  }
  for (const x of boxes) rooms[part[x]].boxes.push(x);
  for (const g of goals) {
    if (part[g] < 0) return null;
    rooms[part[g]].goals.push(g);
  }
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

// Solve one room's sub-board, trying optimal A* first, then weighted
// fallbacks that still solve (fewer points, but better than nothing).
function solveRoom(sub: Board): string | null {
  for (const [cap, weight] of [
    [ROOM_STATES, 1],
    [ROOM_STATES, 2],
    [ROOM_STATES, 5],
  ] as const) {
    const dirs = pushSearch(sub, cap, weight);
    if (dirs !== null) return movesFor(sub, dirs);
  }
  return null;
}

function solveLevel(level: Board): string {
  const rooms = roomsOf(level);
  if (rooms !== null) {
    let player = level.player;
    let moves = '';
    for (const room of rooms) {
      const wall = level.wall.slice();
      for (const other of rooms) {
        if (other === room) continue;
        for (const x of other.done ? other.goals : other.boxes) wall[x] = 1;
      }
      const sub: Board = {
        w: level.w,
        h: level.h,
        wall,
        goals: room.goals.slice().sort((a, b) => a - b),
        boxes: room.boxes.slice().sort((a, b) => a - b),
        player,
      };
      const roomMoves = solveRoom(sub);
      if (roomMoves === null) return '';
      moves += roomMoves;
      // Advance the player along the room's moves on the full board.
      for (const ch of roomMoves.toLowerCase()) {
        const k = STEP.indexOf(ch);
        player += DY[k] * level.w + DX[k];
      }
      room.done = true;
    }
    return moves;
  }
  // No clean room split: fall back to a search over the whole level.
  for (const [cap, weight] of [
    [GLOBAL_STATES, 1],
    [GLOBAL_STATES, 3],
  ] as const) {
    const dirs = pushSearch(level, cap, weight);
    if (dirs !== null) return movesFor(level, dirs);
  }
  return '';
}

function solve(text: string): string {
  try {
    return solveLevel(parseLevel(text));
  } catch {
    return '';
  }
}

for (const id of readdirSync(IN).sort()) {
  const moves = solve(readFileSync(join(IN, id, 'level.txt'), 'utf8'));
  mkdirSync(join(OUT, id), { recursive: true });
  writeFileSync(join(OUT, id, 'solution.txt'), `${moves}\n`);
}
