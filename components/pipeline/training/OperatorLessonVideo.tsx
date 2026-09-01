import { ExternalLink, PlayCircle } from "lucide-react";

import { getOperatorTrainingVideo } from "@/lib/training/operator-training-video-catalog";

export default function OperatorLessonVideo({ moduleId, activityId }: { moduleId: string; activityId: string }) {
  const video = getOperatorTrainingVideo(moduleId, activityId);
  if (!video) return null;

  return (
    <section data-operator-lesson-video="true" className="mt-6 overflow-hidden border border-[#cbd7d3] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d8dfdc] px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.11em] text-[#0c705f]">
            <PlayCircle size={14} aria-hidden="true" /> Video walkthrough
            {video.durationLabel ? <span className="text-[#7b8581]">{video.durationLabel}</span> : null}
          </div>
          <h4 className="mt-1 text-[14px] font-black text-[#202623]">{video.title}</h4>
          {video.summary ? <p className="mt-1 max-w-[760px] text-[10px] leading-4 text-[#68726e]">{video.summary}</p> : null}
        </div>
        <a href={video.watchUrl} target="_blank" rel="noreferrer noopener" className="inline-flex h-9 shrink-0 items-center gap-2 border border-[#c9d4d0] px-3 text-[9px] font-black text-[#355c51] hover:border-[#7ea99c]">
          Open in Loom <ExternalLink size={12} aria-hidden="true" />
        </a>
      </div>
      <div className="aspect-video w-full bg-[#111513]">
        <iframe
          src={video.embedUrl}
          title={`${video.title} video walkthrough`}
          loading="lazy"
          allow="fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="no-referrer"
          className="h-full w-full border-0"
        />
      </div>
    </section>
  );
}
