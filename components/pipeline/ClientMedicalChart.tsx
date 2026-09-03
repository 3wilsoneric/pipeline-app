import type { ClientChartFact, ClientMedicalChartModel } from "@/lib/pipeline/client-medical-chart";

export default function ClientMedicalChart({
  chart,
  dataAsOf,
  sourceLabel,
}: {
  chart: ClientMedicalChartModel;
  dataAsOf: string;
  sourceLabel: string;
}) {
  return (
    <article aria-label="Client medical chart" className="overflow-hidden border border-[#aebbb5] bg-white">
      <header className="flex flex-wrap items-center justify-between gap-4 bg-[#183f37] px-5 py-5 text-white sm:px-7">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.12em] text-[#afd2c8]">Pipeline clinical record</div>
          <h1 className="mt-1 text-[22px] font-black tracking-[-0.025em] sm:text-[24px]">Client medical chart</h1>
        </div>
        <div className="text-[10px] leading-5 text-[#dcece7] sm:text-right">
          <div className="font-black uppercase tracking-[0.08em]">{sourceLabel}</div>
          <div>Data through {formatDate(dataAsOf)}</div>
        </div>
      </header>

      <ChartGrid ariaLabel="Client identity" columns="identity">
        {chart.identity.map((fact) => <ChartCell key={fact.label} fact={fact} />)}
      </ChartGrid>

      <ChartBand title="Clinical priorities">
        <ChartGrid ariaLabel="Clinical priorities" columns="priorities">
          {chart.priorities.map((fact) => <ChartCell key={fact.label} fact={fact} multiline />)}
        </ChartGrid>
      </ChartBand>

      <ChartBand title="Care and support">
        <ChartGrid ariaLabel="Care and support" columns="care">
          {chart.care.map((fact) => <ChartCell key={fact.label} fact={fact} />)}
        </ChartGrid>
      </ChartBand>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#bfcac5] bg-[#f7faf8] px-5 py-3.5 text-[10px] leading-4 text-[#5f6b66] sm:px-7">
        <span>Missing means the field was not documented in the available record.</span>
        {chart.assessmentDate ? <span>Latest assessment {formatDate(chart.assessmentDate)}</span> : null}
      </footer>
    </article>
  );
}

function ChartBand({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`client-chart-${slug(title)}`}>
      <h2 id={`client-chart-${slug(title)}`} className="border-y-2 border-[#aebbb5] bg-[#eaf1ee] px-5 py-2.5 text-[11px] font-black uppercase tracking-[0.09em] text-[#244b41] sm:px-7 sm:text-[12px]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ChartGrid({
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
      ? "md:grid-cols-3"
      : "grid-cols-2 lg:grid-cols-3";
  return <dl aria-label={ariaLabel} className={`grid gap-px bg-[#bfcac5] ${layout}`}>{children}</dl>;
}

function ChartCell({ fact, multiline = false }: { fact: ClientChartFact; multiline?: boolean }) {
  const missing = fact.value === "Not documented";
  const span = fact.span === "wide" ? "col-span-2" : "";
  return (
    <div className={`min-h-[82px] min-w-0 bg-white px-5 py-4 sm:px-6 ${multiline ? "md:min-h-[104px]" : ""} ${span} ${missing && fact.required ? "bg-[#fffaf0]" : ""}`}>
      <dt className="text-[9px] font-black uppercase tracking-[0.09em] text-[#5f6b66] sm:text-[10px]">{fact.label}</dt>
      <dd className={`mt-1.5 break-words font-bold leading-6 ${fact.label === "Client" ? "text-[22px] tracking-[-0.025em] sm:text-[24px]" : multiline ? "text-[14px] sm:text-[15px]" : "text-[14px]"} ${multiline ? "whitespace-pre-line" : ""} ${missing ? "text-[#966715]" : "text-[#18211d]"}`}>
        {fact.label === "Client" ? <h2 data-testid="client-identity-title">{fact.value}</h2> : fact.value}
      </dd>
    </div>
  );
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
