import type { ReactNode } from "react";
import styles from "./ReadableChartText.module.css";

// Display-only formatting. The original answer is retained, and all content remains escaped text.
export default function ReadableChartText({ value }: { value: string }) {
  if (!/^\s*(?:#{1,6}\s+|[-*•]\s+|\d+[.)]\s+)/m.test(value)) return <>{value}</>;
  const lines = value.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const key = index;
    if (!lines[index].trim()) { index++; continue; }
    const heading = /^\s*#{1,6}\s+(.+)$/.exec(lines[index]);
    if (heading) { blocks.push(<strong key={key} className={styles.heading}>{heading[1]}</strong>); index++; continue; }
    const bullet = /^\s*[-*•]\s+(.+)$/.exec(lines[index]);
    const number = /^\s*(\d+)[.)]\s+(.+)$/.exec(lines[index]);
    if (bullet || number) {
      const items: ReactNode[] = [];
      const pattern = bullet ? /^\s*[-*•]\s+(.+)$/ : /^\s*(\d+)[.)]\s+(.+)$/;
      while (index < lines.length) {
        const item = pattern.exec(lines[index]);
        if (!item) break;
        items.push(<li key={index} value={number ? Number(item[1]) : undefined}>{item[number ? 2 : 1]}</li>);
        index++;
      }
      blocks.push(bullet ? <ul key={key}>{items}</ul> : <ol key={key} start={Number(number![1])}>{items}</ol>);
      continue;
    }
    const paragraph: string[] = [];
    do { paragraph.push(lines[index++]); }
    while (index < lines.length && lines[index].trim() && !/^\s*(?:#{1,6}\s+|[-*•]\s+|\d+[.)]\s+)/.test(lines[index]));
    blocks.push(<p key={key}>{paragraph.join("\n")}</p>);
  }
  return <div className={styles.text}>{blocks}</div>;
}
