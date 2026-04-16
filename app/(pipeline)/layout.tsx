import PipelineAppShell from "@/components/pipeline/PipelineAppShell";

export default function PipelineLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PipelineAppShell>{children}</PipelineAppShell>;
}
