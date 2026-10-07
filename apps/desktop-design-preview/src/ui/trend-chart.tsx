export interface TrendPoint {
  label: string;
  completed: number;
  blockers: number;
}

export function trendBarHeight(value: number, maximum: number): string {
  if (maximum <= 0) return "0%";
  return `${Math.max(0, Math.min(100, (value / maximum) * 100))}%`;
}

export function TrendChart(props: { points: readonly TrendPoint[] }) {
  const maximum = Math.max(1, ...props.points.flatMap((point) => [point.completed, point.blockers]));

  return (
    <div className="trend-chart" aria-label="交付趋势">
      {props.points.map((point) => (
        <div className="trend-column" key={point.label}>
          <div className="trend-bars">
            <span
              aria-label={`${point.label}完成 ${point.completed}`}
              data-series="completed"
              style={{ height: trendBarHeight(point.completed, maximum) }}
              title={`完成 ${point.completed}`}
            />
            <em
              aria-label={`${point.label}阻塞 ${point.blockers}`}
              data-series="blockers"
              style={{ height: trendBarHeight(point.blockers, maximum) }}
              title={`阻塞 ${point.blockers}`}
            />
          </div>
          <small>{point.label}</small>
        </div>
      ))}
    </div>
  );
}
