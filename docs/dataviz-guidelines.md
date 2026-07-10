# Debate Suite Data Visualization Guidelines

- Use stat tiles for headline metrics such as win rate, evidence count, unresolved source count.
- Use a single axis per chart. Do not use dual-axis charts.
- Keep categorical colors fixed by entity: side, argument category, tournament, or user. Do not recolor when filters change.
- Use one hue light-to-dark for sequential magnitude.
- Use diverging colors only for polarity, with a neutral midpoint.
- Keep status colors reserved for actual states: good, warning, serious, critical.
- Every chart with two or more series needs a legend; direct labels are allowed for up to four series.
- Every interactive chart should have tooltip support and a table view.
- Current MVP uses accessible stat cards and chart placeholders until real structured match data exists.
