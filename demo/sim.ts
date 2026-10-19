// Runs the autopilot headless over a range of seeds, to find worlds it gets through.
// npx tsx demo/sim.ts <first seed> <count> <seconds>

import { Game } from '../hooks/game'
import { Autopilot } from './autopilot'

const [from = 1, count = 40, seconds = 28] = process.argv.slice(2).map(Number)

for (let seed = from; seed < from + count; seed++) {
  const game = new Game(seed, 0, 0)
  const pilot = new Autopilot()
  game.input('up')
  const kinds = new Set<string>()
  let t = 0
  while (game.phase === 'play' && t < seconds) {
    // live frames are not quite even
    const dt = 1 / 30 + (Math.random() - 0.5) * 0.01
    game.update(dt)
    t += dt
    const dir = pilot.decide(game, dt)
    if (dir) game.input(dir)
    kinds.add(game.row(Math.round(game.z))?.kind ?? '')
  }
  const end = game.death?.kind ?? 'alive'
  console.log(`${seed}\tscore ${game.score}\t${t.toFixed(1)}s\ttokens ${game.tokens}\t${end}\t${[...kinds].join(',')}`)
}
