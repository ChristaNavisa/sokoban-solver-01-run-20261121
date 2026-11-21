[![make.fun](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/ChristaNavisa/sokoban-solver-01-run-20261121/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/ChristaNavisa/sokoban-solver-01-run-20261121/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)

# Push-Optimal Sokoban Solver

A push-optimal Sokoban solver. Every level is one hallway plus 1–4 small rooms (3–4 boxes each); a box pushed out of a room can never come back, so each room is solved on its own from its door and the rooms' push counts add up to the level's optimum. Per room it runs A* over pushes (not steps): a state is the sorted box squares plus the player's reachable region, the cost is pushes, and the estimate is the cheapest assignment of boxes to goals by shortest floor distance, which never overestimates. Dead squares and frozen 2x2 blocks are pruned.

## Results

Practice score **1,000,000 / 1,000,000** on the kit's practice set (26/26 fresh sets perfect), beating the house baseline plain-astar 1.0.0 (200,000). The per-room decomposition is what makes the optimum reachable: each room's push-optimal cost is computed independently and summed, so the solver never searches the full joint state space.

## How to run

The program runs as `node main.ts` (Node 22, which strips TypeScript types natively). It reads each instance from `$MAKEFUN_INPUT_DIR/<id>/` (default `/input`) and writes the move string as `$MAKEFUN_OUTPUT_DIR/<id>/solution.txt` (default `/output`), creating the output directory itself. Moves are LURD letters (`u`, `d`, `l`, `r`, upper or lower case). All budgets are fixed node counts, never the clock, so two runs write identical bytes. The 60-second wall budget for the whole 5-instance set is met by fixed work budgets, not the clock.

## License

MIT — see `LICENSE`.
