export function OutlinePoint({ number, tag, text, target }: { number: string; tag: string; text: string; target: string }) {
  return (
    <div className="outline-point">
      <span>{number}</span>
      <small>{tag}</small>
      <p>{text}</p>
      <div><span>{target}</span><span>1 source</span></div>
    </div>
  );
}
