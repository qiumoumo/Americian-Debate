interface ChartPlaceholderProps {
  title: string;
  description: string;
}

export function ChartPlaceholder({ title, description }: ChartPlaceholderProps) {
  return (
    <div className="chart-placeholder" role="img" aria-label={`${title}: ${description}`}>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
        <small>Future chart: fixed categorical colors, direct labels, legend, tooltip, and table view.</small>
      </div>
    </div>
  );
}
