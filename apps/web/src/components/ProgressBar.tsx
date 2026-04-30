export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="book-progress">
      <span>{value}%</span>
      <div className="progress-track">
        <span style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
