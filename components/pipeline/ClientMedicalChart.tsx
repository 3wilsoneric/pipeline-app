import type { ClientChartFact, ClientMedicalChartModel } from "@/lib/pipeline/client-medical-chart";
import ReadableChartText from "@/components/pipeline/ReadableChartText";
import { Pencil } from "lucide-react";

export type ChartEditActions = Partial<Record<string, () => void>>;

// The edit control stays visible (not hover-revealed) and names where it goes,
// because every chart edit opens a canonical editor rather than editing inline.
function ChartFieldLabel({ label, onEdit, editHint = "Edit" }: { label: string; onEdit?: () => void; editHint?: string }) {
  return onEdit ? <button type="button" aria-label={`Edit ${label}`} title={`${editHint}: ${label}`} onClick={onEdit} data-chart-edit={label}
    className="group -my-3 inline-flex min-h-11 max-w-full flex-wrap items-center gap-x-2.5 gap-y-1 rounded-sm text-left hover:text-[#08735e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#08735e]">
    <span>{label}</span>
    <span aria-hidden="true" className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold leading-4 text-[#0a6a58] underline-offset-2 group-hover:underline">
      <Pencil size={12} className="shrink-0" />{editHint}
    </span>
  </button> : label;
}

export default function ClientMedicalChart({
  chart,
  dataAsOf,
  headerActions,
  editActions,
}: {
  chart: ClientMedicalChartModel;
  dataAsOf: string;
  sourceLabel: string;
  headerActions?: React.ReactNode;
  editActions?: ChartEditActions;
}) {
  return (
    <ClientChartFrame label="Client medical chart">
      <ClientChartHeader title="Client chart" actions={headerActions}>
        <ChartHeaderCell label="Data through" value={formatDate(dataAsOf)} />
      </ClientChartHeader>

      <ChartGrid ariaLabel="Client identity" columns="identity">
        {chart.identity.map((fact) => <ChartCell key={fact.label} fact={fact} onEdit={editActions?.[fact.label]} editHint="Edit in intake" />)}
      </ChartGrid>

      <ChartBand title="Clinical priorities">
        <ChartGrid ariaLabel="Clinical priorities" columns="priorities">
          {chart.priorities.map((fact) => <ChartCell key={fact.label} fact={fact} multiline onEdit={editActions?.[fact.label]} editHint="Edit in intake" />)}
        </ChartGrid>
      </ChartBand>

      <ChartBand title="Care and support">
        <ChartGrid ariaLabel="Care and support" columns="care">
          {chart.care.map((fact) => <ChartCell key={fact.label} fact={fact} onEdit={editActions?.[fact.label]} editHint="Edit in intake" />)}
        </ChartGrid>
      </ChartBand>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#d9e0dc] bg-[#f8faf9] px-5 py-3.5 text-[12px] leading-5 text-[#5f6b66] sm:px-7">
        <span>Missing means the field was not documented in the available record.</span>
        {chart.assessmentDate ? <span>Latest assessment {formatDate(chart.assessmentDate)}</span> : null}
      </footer>
    </ClientChartFrame>
  );
}

export function ClientChartFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return <article aria-label={label} className="min-w-0 overflow-hidden border border-[#d4dcd8] bg-white">{children}</article>;
}

export function ClientChartHeader({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return <header className="grid grid-cols-1 border-b border-[#d4dcd8] bg-[#f5f7f6] sm:grid-cols-[1fr_auto_auto]">
    <div className={`flex min-w-0 flex-wrap items-center justify-between gap-x-4 px-5 sm:px-6 ${actions ? "py-1" : "py-3.5"}`}>
      <div className="flex items-center gap-2.5">
      <span aria-hidden="true" className="h-6 w-1 bg-[#2f8475]" />
      <h1 className="text-[21px] font-bold tracking-[-0.02em] text-[#1d2924]">{title}</h1>
      </div>
      {actions}
    </div>
    {children}
  </header>;
}

export function ChartHeaderCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-t border-[#c3cec9] px-4 py-2.5 sm:border-l sm:border-t-0 sm:px-5">
      <div className="text-[12px] font-semibold text-[#59675f]">{label}</div>
      <div className="mt-0.5 break-words text-[14px] font-semibold text-[#28332e]">{value}</div>
    </div>
  );
}

export function ChartBand({ title, detail, children }: { title: string; detail?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`client-chart-${slug(title)}`}>
      <h2 id={`client-chart-${slug(title)}`} className="flex flex-wrap items-baseline justify-between gap-2 border-y border-[#d9e0dc] bg-[#f5f7f6] px-5 py-3 text-[17px] font-bold text-[#29483d] sm:px-7">
        {title}
        {detail ? <span className="text-[13px] font-medium text-[#5f6b66]">{detail}</span> : null}
      </h2>
      {children}
    </section>
  );
}

export function ChartGrid({
  ariaLabel,
  columns,
  children,
}: {
  ariaLabel: string;
  columns: "identity" | "priorities" | "care";
  children: React.ReactNode;
}) {
  const layout = columns === "identity"
    ? "grid-cols-2 lg:grid-cols-6"
    : columns === "priorities"
      ? "lg:grid-cols-2"
      : "sm:grid-cols-2 lg:grid-cols-3";
  return <dl aria-label={ariaLabel} className={`grid gap-px bg-[#e0e5e2] ${layout}`}>{children}</dl>;
}

function chartCellSpan(fact: ClientChartFact, multiline: boolean) {
  if (fact.span === "wide") return "col-span-2";
  return multiline && (fact.value.length > 160 || fact.label === "Medications on record") ? "lg:col-span-2" : "";
}

export function ChartCell({ fact, multiline = false, onEdit, editHint }: { fact: ClientChartFact; multiline?: boolean; onEdit?: () => void; editHint?: string }) {
  const missing = fact.value === "Not documented";
  const span = chartCellSpan(fact, multiline);
  return (
    <div data-chart-field={fact.label} className={`min-h-[82px] min-w-0 bg-white px-5 py-4 sm:px-6 ${span} ${missing && fact.required ? "bg-[#fffaf0]" : ""}`}>
      <dt className="text-[13px] font-semibold leading-5 text-[#59675f]"><ChartFieldLabel label={fact.label} onEdit={onEdit} editHint={editHint} /></dt>
      <dd className={`mt-1.5 max-w-[76ch] whitespace-pre-line [overflow-wrap:anywhere] leading-[1.65] ${fact.label === "Client" ? "text-[24px] font-bold tracking-[-0.025em] sm:text-[27px]" : "text-[16px] font-medium"} ${missing ? fact.required ? "text-[#865e20]" : "text-[#68716d]" : "text-[#18211d]"}`}>
        {fact.label === "Client" ? <h2 data-testid="client-identity-title">{fact.value}</h2> : <ReadableChartText value={fact.value} />}
      </dd>
    </div>
  );
}

export function ChartFacts({ facts, className = "", editActions, editHint }: { facts: { label: string; value: string | number | null; onEdit?: () => void }[]; className?: string; editActions?: ChartEditActions; editHint?: string }) {
  return <dl className={`grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2 ${className}`}>
    {facts.map((fact, index) => {
      const value = String(fact.value ?? "").trim();
      const narrative = value.length > 160 || value.includes("\n");
      return <div key={`${index}:${fact.label}`} data-chart-fact={fact.label} className={`min-w-0 ${narrative ? "sm:col-span-2" : ""}`}>
        <dt className="text-[13px] font-semibold leading-5 text-[#59675f]"><ChartFieldLabel label={fact.label} onEdit={fact.onEdit ?? editActions?.[fact.label]} editHint={editHint} /></dt>
        <dd className={`mt-1.5 max-w-[76ch] whitespace-pre-line [overflow-wrap:anywhere] text-[16px] leading-[1.7] ${value ? "text-[#18211d]" : "text-[#68716d]"}`}><ReadableChartText value={value || "Not reported"} /></dd>
      </div>;
    })}
  </dl>;
}

function formatDate(value: string) {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
