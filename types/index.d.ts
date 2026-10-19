// What the pane's text rows show: the line under the picture and which screen is up.
export type CrossyUi = {
  screen: 'game' | 'picker'
  status: string
}

// What is kept between sessions in $.store under "save".
export type CrossySave = {
  best: number
  tokens: number
  owned: string[]
  selected: string
  games: number
  hops: number
  deaths: Record<string, number>
}

declare module 'claude-code' {
  interface PluginState {
    'crossy-code': { ui: CrossyUi }
  }
}
