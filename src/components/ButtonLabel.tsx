export function ButtonLabel({ value, reserve }: { value: string; reserve: string[] }) {
  return (
    <span className="inline-grid place-items-center">
      {reserve.map((item) => (
        <span key={item} className="invisible col-start-1 row-start-1" aria-hidden="true">
          {item}
        </span>
      ))}
      <span className="col-start-1 row-start-1">{value}</span>
    </span>
  );
}
