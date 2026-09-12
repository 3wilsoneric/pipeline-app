export default function ReadableChartText({ value }: { value: string }) {
  if (!/^\s*#{1,6}\s+/m.test(value)) return <>{value}</>;
  return <>{value.split(/\r?\n/).map((line, index) => {
    const heading = /^\s*#{1,6}\s+(.+)$/.exec(line);
    return <span key={index} className={`block whitespace-pre-wrap ${heading ? "mb-1 mt-4 font-bold" : "min-h-5"}`}>{heading ? heading[1] : line}</span>;
  })}</>;
}
