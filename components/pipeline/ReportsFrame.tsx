"use client";

import type { ReactNode } from "react";
import { pushPipelineHistory } from "@/lib/pipeline/client-navigation";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import styles from "./ReportsFrame.module.css";

export default function ReportsFrame({ report, admissionFlow, scorecard, children }: {
  report: string | null;
  admissionFlow: boolean;
  scorecard: boolean;
  children: ReactNode;
}) {
  const pages = [
    { key: "", label: "Admissions & census" },
    ...(admissionFlow ? [{ key: "admission_flow", label: "Admission flow" }] : []),
    ...(scorecard ? [{ key: "assessor_scorecard", label: "Assessor scorecard" }] : []),
  ];
  const current = pages.some((page) => page.key === report) ? report : "";
  return <div className={styles.frame}>
    <nav aria-label="Reports" className={styles.navigation}>
      {pages.map((page) => {
        const path = `/?screen=operations${page.key ? `&report=${page.key}` : ""}`;
        return <a key={page.key} href={toPipelinePath(path)} aria-current={current === page.key ? "page" : undefined}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
            event.preventDefault();
            if (current !== page.key) pushPipelineHistory(path);
          }}>{page.label}</a>;
      })}
    </nav>
    <div className={styles.content}>{children}</div>
  </div>;
}
