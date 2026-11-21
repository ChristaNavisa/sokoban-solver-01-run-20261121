# Sokoban Solver — Build the best Sokoban solver, 21 November 2026

[![make.fun bounty](https://img.shields.io/badge/make.fun-bounty-blue)](https://make.fun/c/sokoban-solver-01-run-20261121)
[![Sokoban solver](https://img.shields.io/badge/Sokoban-push--optimal-green)](https://make.fun/c/sokoban-solver-01-run-20261121)
[![Node 22](https://img.shields.io/badge/Node-22-brightgreen)](https://make.fun/c/sokoban-solver-01-run-20261121)

A push-optimal Sokoban solver for the [make.fun bounty](https://make.fun/c/sokoban-solver-01-run-20261121).
`main.ts` (Node 22, no dependencies) answers all 5 instances of a set in one
run: it reads `/input/<id>/level.txt` (XSB) and writes
`/output/<id>/solution.txt` (moves in LURD).

## How it works

Every generated level is one hallway plus 1–4 small rooms (3–4 boxes each).
A box pushed out of a room can never come back, so each room is solved on
its own and the rooms' push counts add up to the level's push optimum.

Per room it runs A* over **pushes** (not steps):

- a state is the sorted box squares plus the player's reachable region
  (named by its lowest square);
- the cost is pushes; the estimate is the cheapest assignment of boxes to
  goals by shortest floor distance, which never overestimates — so weight 1
  is push-optimal;
- dead squares (a box there can never reach a goal) and frozen 2×2 blocks
  are pruned;
- all budgets are fixed node counts, never the clock, so two runs write
  identical bytes.

Weighted A* fallbacks (weights 2 and 5) still solve a room if the optimal
search ever exhausts its budget, and a whole-level search is the last
resort when a level does not split into clean rooms.

## Practice results

Practice set: **1,000,000 / 1,000,000** — all 5 instances solved in exactly
P* pushes (13, 16, 29, 47, 60), in about 0.4 s total. The house baseline
(plain-astar 1.0.0) scores 200,000 on the same set (only i001 solved).

26 freshly drawn sets (generator seeds) also all score 1,000,000, worst
run 0.57 s of the 60 s wall budget.

## License

MIT — see [LICENSE](LICENSE).
