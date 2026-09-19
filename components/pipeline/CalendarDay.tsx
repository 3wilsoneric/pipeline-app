import { ArrowUpRight, CalendarClock, Check, Clock3, FilePenLine } from "lucide-react";
import type { ReactNode } from "react";
import type { PipelineCalendarEvent, PipelineUnscheduledAssessment } from "@/lib/pipeline/calendar-types";
import { appointmentStatusLabel, calendarClientName, eventTime, longDate, methodLabel } from "@/components/pipeline/pipeline-calendar-model";
import styles from "./CalendarWork.module.css";

export default function CalendarDay({ date, loading, error, appointments, followUps, continuing, unscheduled, hasMore, onOpen, onContinue, onPrepare, onSchedule, onQueue }: {
  date: string; loading: boolean; error: string;
  appointments: PipelineCalendarEvent[]; followUps: PipelineCalendarEvent[]; continuing: PipelineCalendarEvent[];
  unscheduled: PipelineUnscheduledAssessment[]; hasMore: boolean;
  onOpen: (event: PipelineCalendarEvent) => void; onContinue: (event: PipelineCalendarEvent) => void;
  onPrepare: (item: PipelineUnscheduledAssessment) => void; onSchedule: (item: PipelineUnscheduledAssessment) => void;
  onQueue: () => void;
}) {
  if (loading) return <div className={styles.loading} role="status">Loading your day…</div>;
  if (error && !appointments.length && !followUps.length && !continuing.length && !unscheduled.length) return null;
  return <div className={styles.day}>
    <div className={styles.primary}>
      <WorkSection title="Appointments" icon={<CalendarClock size={18} />} empty={!appointments.length ? "No appointments on this day." : undefined}>
        {appointments.map((event) => <article className={styles.appointment} key={event.id}>
          <div className={styles.time}><strong>{eventTime(event.startsAt)}</strong><span>{event.durationMinutes ?? 60} min</span></div>
          <button type="button" className={styles.identity} onClick={() => onOpen(event)} aria-label={`Appointment details for ${event.clientName}`}>
            <strong>{calendarClientName(event.clientName, event.community)}</strong>
            <span>{[methodLabel(event.method), event.community, event.owner].filter(Boolean).join(" · ")}</span>
            <span className={styles.state}>{event.scheduleStatus === "completed" ? <Check size={14} /> : null}{appointmentStatusLabel(event)}</span>
          </button>
          <button type="button" className={styles.action} onClick={() => onContinue(event)} aria-label={`Open assessment for ${event.clientName}`}>Open assessment <ArrowUpRight size={15} /></button>
        </article>)}
      </WorkSection>
      <WorkSection title="Follow-ups" icon={<Clock3 size={18} />} empty={!followUps.length ? "No dated follow-ups due." : undefined}>
        {followUps.map((event) => <button type="button" key={event.id} onClick={() => onOpen(event)} className={styles.followUp}>
          <span className={styles.identity}><strong>{calendarClientName(event.clientName, event.community)}</strong><span>{event.followUpLabels?.join(" · ") || event.title}</span><span>{event.owner}</span></span>
          <span className={event.date < date ? styles.pastDue : styles.state}>{event.date < date ? `Due ${longDate(event.date)}` : "Due this day"}</span>
        </button>)}
      </WorkSection>
    </div>
    <div className={styles.secondary}>
      <WorkSection title="Continue working" icon={<FilePenLine size={18} />} empty={!continuing.length ? "No unfinished assessments to return to." : undefined}>
        {continuing.map((event) => <article className={styles.work} key={event.id}>
          <button type="button" className={styles.identity} onClick={() => onOpen(event)}><strong>{calendarClientName(event.clientName, event.community)}</strong><span>{appointmentStatusLabel(event)}</span><span>{event.owner}</span></button>
          <button type="button" onClick={() => onContinue(event)} className={styles.action} aria-label={`Continue assessment for ${event.clientName}`}>Continue <ArrowUpRight size={15} /></button>
        </article>)}
      </WorkSection>
      <WorkSection title="Needs a date" icon={<CalendarClock size={18} />} empty={!unscheduled.length ? "No referrals waiting for a date." : undefined}>
        {unscheduled.slice(0, 6).map((item) => <article className={styles.work} key={item.referralId}>
          <button type="button" className={styles.identity} onClick={() => onPrepare(item)}><strong>{calendarClientName(item.clientName, item.community)}</strong><span>{[item.community, item.owner].filter(Boolean).join(" · ")}</span><span>{item.nextAction === "complete_contact" ? "Contact details can be added" : item.nextAction === "assign" ? "Assessor not assigned" : item.nextAction === "complete_intake" ? "Intake in progress" : "Ready to schedule"}</span></button>
          <button type="button" className={styles.action} onClick={() => onSchedule(item)} aria-label={`Schedule ${item.clientName}`}>Schedule <ArrowUpRight size={15} /></button>
        </article>)}
        {hasMore || unscheduled.length > 6 ? <button type="button" className={styles.action} onClick={onQueue}>View scheduling queue <ArrowUpRight size={15} /></button> : null}
      </WorkSection>
    </div>
  </div>;
}

function WorkSection({ title, icon, empty, children }: { title: string; icon: ReactNode; empty?: string; children: ReactNode }) {
  return <section className={styles.section} aria-label={title}><h2>{icon}{title}</h2>{empty ? <p className={styles.empty}>{empty}</p> : <div className={styles.cards}>{children}</div>}</section>;
}
