import styles from "./PipelineIllustration.module.css";
import type { AssessmentToolSection } from "@/lib/assessment/assessment-tool-schema";

export type PipelineIllustrationKind = "folder" | "calendar" | "client" | "intake" | "assignment" | "assessment" | "decision" | "report" | "chart" | "placement" | "conversation" | "daily-living" | "health" | "medication" | "home" | "history" | "recovery" | "safety" | "legal" | "connections" | "diet";

const sectionPictures: Record<AssessmentToolSection, PipelineIllustrationKind> = {
  identity: "client", diagnosis_clinical: "conversation", functional_adl: "daily-living",
  physical_health: "health", medication: "medication", prior_placement: "home",
  prior_history: "history", substance_use: "recovery", behavioral_risk: "safety",
  legal_conservatorship: "legal", social_support: "connections", provenance_qc: "assessment",
};

export function AssessmentSectionIllustration({ section, size = 40 }: { section: AssessmentToolSection; size?: number }) {
  return <PipelineIllustration kind={sectionPictures[section]} size={size} />;
}

/** Decorative object identities, following Carelog's service pictures. Status stays in the existing labels. */
export default function PipelineIllustration({ kind, size = 40 }: { kind: PipelineIllustrationKind; size?: number }) {
  const paper = "var(--color-paper)";
  const soft = "var(--picture-soft)";
  const fill = "var(--picture-fill)";
  return <svg className={styles.picture} data-pipeline-picture={kind} width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="var(--color-picture-ink)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {kind === "diet" && <>
      <circle cx="32" cy="33" r="19" fill={soft} /><circle cx="32" cy="33" r="13" fill={paper} />
      <path d="M6 8v17m-4-17v11c0 8 8 8 8 0V8M6 27v29M59 8c-8 6-8 22 0 22v26V8Z" />
      <g className={styles.moving}><path d="M25 35c-2-10 11-13 16-11 1 12-10 18-16 11Z" fill={fill} /><path d="m25 38 10-10" /></g>
    </>}
    {kind === "conversation" && <>
      <path d="M28 25h29v23h-8v8l-10-8H28Z" fill={soft} /><path d="M35 34h14m-14 7h9" />
      <g className={styles.moving}><path d="M7 8h34v24H23l-9 8v-8H7Z" fill={fill} /><path d="M15 17h18m-18 7h11" /></g>
    </>}
    {kind === "daily-living" && <>
      <path d="m22 9-16 10 7 13 8-5v29h25V27l7 5 7-13L44 9Z" fill={soft} />
      <path d="M22 9c1 12 21 12 22 0M22 47h23" />
      <g className={styles.moving}><path d="M30 29h10v12H30Z" fill={fill} /><path d="M31 33h8" /></g>
    </>}
    {kind === "health" && <>
      <path d="M23 17v-7h18v7" /><rect x="7" y="17" width="50" height="38" rx="4" fill={soft} /><path d="M7 28h50" />
      <g className={styles.moving}><path d="M28 31h8v7h7v8h-7v7h-8v-7h-7v-8h7Z" fill={fill} /></g>
    </>}
    {kind === "medication" && <>
      <rect x="15" y="6" width="30" height="9" rx="2" fill={fill} /><path d="M19 15v6c-6 1-9 5-9 10v23h40V31c0-5-3-9-9-10v-6" fill={soft} />
      <path d="M10 33h40v15H10Z" fill={paper} /><path d="M18 39h16" />
      <g className={styles.moving}><rect x="43" y="37" width="12" height="22" rx="6" transform="rotate(25 49 48)" fill={fill} /><path d="m44 45 11 5" /></g>
    </>}
    {kind === "home" && <>
      <path d="M12 28v28h40V28L32 11Z" fill={soft} /><path d="m6 30 26-23 26 23" />
      <g className={styles.moving}><path d="M26 56V35h13v21" fill={fill} /><path d="M34 45h1" /></g>
      <path d="M17 33h5v9h-5" fill={paper} />
    </>}
    {kind === "history" && <>
      <path d="M12 8h32l8 8v42H12Z" fill={paper} /><path d="M44 8v9h8M22 20v29" />
      <g className={styles.moving}><circle cx="22" cy="23" r="4" fill={fill} /><circle cx="22" cy="36" r="4" fill={soft} /><circle cx="22" cy="49" r="4" fill={soft} /></g>
      <path d="M32 23h11m-11 13h11m-11 13h8" />
    </>}
    {kind === "recovery" && <>
      <path d="M5 37h54v19H5Z" fill={soft} /><path d="M19 37a13 13 0 0 1 26 0" fill={fill} />
      <g className={styles.moving}><path d="M32 7v8M9 20l6 5m40-5-6 5" /></g>
      <path d="M25 56c0-10 15-8 15-19M5 37h54" />
    </>}
    {kind === "safety" && <>
      <path d="M10 16 32 7l22 9v15c0 13-10 22-22 27C20 53 10 44 10 31Z" fill={soft} />
      <g className={styles.moving}><path d="M32 17 20 22v10c0 8 5 13 12 17 7-4 12-9 12-17V22Z" fill={fill} /><path d="M32 24v16" /></g>
    </>}
    {kind === "legal" && <>
      <path d="M32 9v46M17 56h30M11 21h42M13 21 5 40h16l-8-19Zm38 0-8 19h16l-8-19Z" fill={soft} />
      <g className={styles.moving}><path d="M5 40c0 10 16 10 16 0m22 0c0 10 16 10 16 0" fill={fill} /></g><circle cx="32" cy="12" r="5" fill={fill} />
    </>}
    {kind === "connections" && <>
      <circle cx="17" cy="16" r="7" fill={fill} /><circle cx="47" cy="16" r="7" fill={soft} />
      <path d="M5 48V37c0-12 24-12 24 0m6 0c0-12 24-12 24 0v11" fill={soft} />
      <g className={styles.moving}><circle cx="32" cy="30" r="6" fill={paper} /><path d="M22 57V47c0-9 20-9 20 0v10" fill={fill} /></g>
    </>}
    {kind === "chart" && <>
      <path d="M12 8h35v48H12Z" fill={soft} /><path d="M47 15h7v10h-7m0 5h7v10h-7" fill={fill} />
      <g className={styles.moving}><path d="M8 12h35v44H8Z" fill={paper} /><circle cx="25" cy="25" r="6" fill={soft} /><path d="M17 39c0-9 16-9 16 0Z" fill={fill} /><path d="M16 47h19" /></g>
    </>}
    {kind === "placement" && <>
      <path d="m7 26 25-18 25 18v29H7Z" fill={soft} />
      <g className={styles.moving}><path d="M17 7h30v36H17Z" fill={paper} /><path d="M24 17h16m-16 8h16m-16 8h10" /></g>
      <path d="m7 26 25 17 25-17v29H7Z" fill={fill} /><path d="m7 55 18-17m32 17L39 38" />
    </>}
    {kind === "folder" && <>
      <path d="M7 20V12h19l6 7h24v34H7Z" fill={soft} />
      <path d="M16 12h24l7 7v29H16Z" fill={paper} />
      <path d="M40 12v8h7M23 24h16" />
      <g className={styles.moving}><path d="M7 29h50l-6 25H7Z" fill={fill} /><path d="M16 38h15" /></g>
    </>}
    {kind === "calendar" && <>
      <rect x="8" y="11" width="48" height="45" rx="4" fill={soft} />
      <path d="M8 24h48M20 6v10m24-10v10" />
      <g className={styles.moving}><path d="M18 34h7v7h-7zM29 34h7v7h-7zM40 34h7v7h-7z" fill={fill} /><path d="M18 48h17" /></g>
    </>}
    {kind === "client" && <>
      <rect x="20" y="7" width="34" height="42" rx="4" fill={soft} />
      <g className={styles.moving}><rect x="8" y="15" width="36" height="42" rx="4" fill={paper} />
      <circle cx="26" cy="30" r="7" fill={soft} /><path d="M14 49v-3c0-10 24-10 24 0v3Z" fill={fill} /></g>
    </>}
    {kind === "intake" && <>
      <rect x="12" y="11" width="38" height="46" rx="4" fill={soft} />
      <path d="M23 7h16v10H23Z" fill={paper} /><path d="M20 27h21m-21 8h15m-15 8h10" />
      <g className={styles.moving}><circle cx="48" cy="47" r="11" fill={fill} /><path d="M48 42v10m-5-5h10" /></g>
    </>}
    {kind === "assignment" && <>
      <path d="M8 36 14 25h36l6 11v19H8Z" fill={soft} />
      <g className={styles.moving}><path d="M19 7h26v35H19Z" fill={paper} /><path d="M25 16h14m-14 7h14m-14 7h8" /></g>
      <path d="M8 36h15l4 7h10l4-7h15v19H8Z" fill={fill} />
    </>}
    {kind === "assessment" && <>
      <path d="M10 6h28l9 9v42H10Z" fill={soft} /><path d="M38 6v10h9M18 24h20m-20 9h14m-14 9h9" />
      <g className={styles.moving}><path d="m35 46 16-23 7 5-16 23-10 4Z" fill={fill} /><path d="m48 28 7 5M35 46l7 5" /></g>
    </>}
    {kind === "decision" && <>
      <path d="M10 6h28l9 9v42H10Z" fill={soft} /><path d="M38 6v10h9M18 24h19m-19 9h10m-10 9h8" />
      <g className={styles.moving}><path d="m46 47 10 10 4-4-10-10Z" fill={fill} />
      <circle cx="41" cy="38" r="13" fill={fill} /><circle cx="41" cy="38" r="8" fill={paper} /><path d="M37 36h8m-8 5h5" /></g>
    </>}
    {kind === "report" && <>
      <path d="M10 6h32l10 10v42H10Z" fill={paper} /><path d="M42 6v11h10M18 24h21" />
      <g className={styles.moving}><path d="M18 49V37h7v12Z" fill={soft} /><path d="M29 49V31h7v18Z" fill={fill} /><path d="M40 49V39h7v10Z" fill={soft} /></g><path d="M17 50h31" />
    </>}
  </svg>;
}
