// TODO: sample data. Replace with live figures.

export const totals = {
  volume: 1_284_000_000,
  volumeChange: '▲ 18.2%',
  tvl: 184_600_000,
  tvlChange: '▲ 9.6%',
}

export const months = ['O', 'N', 'D', 'J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S']

export const chartSeries = {
  tvl: {
    title: 'Total value locked',
    label: 'TVL',
    data: [42, 51, 49, 63, 71, 78, 92, 104, 118, 131, 159, 184.6],
    max: 200,
    yLabels: ['$200M', '$133M', '$67M', '$0'],
  },
  vol: {
    title: 'Monthly volume',
    label: 'Volume',
    data: [38, 45, 61, 52, 70, 84, 79, 96, 112, 104, 128, 142],
    max: 150,
    yLabels: ['$150M', '$100M', '$50M', '$0'],
  },
}

export type ChartMetric = keyof typeof chartSeries

export const aboutStats = [
  { label: 'PROJECTS LIVE', value: '04', gold: false },
  { label: 'IN THE LAB', value: '02', gold: false },
  { label: 'TOTAL VALUE LOCKED', value: '$184.6M', gold: true },
  { label: 'TOTAL VOLUME', value: '$1.28B', gold: false },
]

export function formatMoney(v: number) {
  return v >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : '$' + (v / 1e6).toFixed(1) + 'M'
}
