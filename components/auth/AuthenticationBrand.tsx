import PipelineLogoMark from "@/components/pipeline/PipelineLogoMark";

export default function AuthenticationBrand() {
  return (
    <div className="flex min-h-11 items-center justify-center gap-4" aria-label="Alamo Health Pipeline">
      <div className="whitespace-nowrap text-[17px] font-semibold leading-none text-[#595959]">
        <span className="font-black text-[#08745f]">Alamo</span>
        <span className="ml-1">Health</span>
      </div>
      <span aria-hidden="true" className="h-9 w-px shrink-0 bg-[#d9d9d9]" />
      <div className="flex items-center gap-2.5 whitespace-nowrap">
        <PipelineLogoMark size={34} />
        <span className="text-[13px] font-black uppercase tracking-[0.12em] text-[#0f6f5e]">Pipeline</span>
      </div>
    </div>
  );
}

export function MicrosoftMark({ size = 18 }: { size?: number }) {
  return (
    <span
      className="grid shrink-0 grid-cols-2 gap-[2px]"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="bg-[#f25022]" />
      <span className="bg-[#7fba00]" />
      <span className="bg-[#00a4ef]" />
      <span className="bg-[#ffb900]" />
    </span>
  );
}
