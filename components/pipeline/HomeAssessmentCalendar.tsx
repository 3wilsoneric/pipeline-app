"use client";

import { useEffect, useId, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import HomeDialog, { type HomeDialogOrigin } from "./HomeDialog";
import { calendarRange, dateKeys, eventTime, groupEventsByDate, longDate, methodLabel, parseDate, rangeLabel, shiftAnchor, todayKey } from "./pipeline-calendar-model";
import { fetchCurrentPipelineUser, fetchPipelineJson, usePipelineDataGeneration } from "@/lib/auth/authenticated-fetch";
import { assessmentEventNextStep } from "@/lib/pipeline/assessment-calendar";
import { isAssignedToUser } from "@/lib/pipeline/referral-ownership";
import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
import type { PipelineCalendarEvent, PipelineCalendarResponse } from "@/lib/pipeline/calendar-types";
import type { HomeBriefingSnapshot } from "@/lib/pipeline/home-briefing-types";
import type { AssessmentEntryAction, PipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";
import type { Referral } from "@/lib/pipeline/referral-types";
import styles from "./HomeAssessmentCalendar.module.css";

export function AssessmentCalendarTile({ date, count, unavailable, onOpen }: {
  date: string;
  count: number;
  unavailable: boolean;
  onOpen: (origin: HomeDialogOrigin) => void;
}) {
  const descriptionId = useId();
  return <button type="button" className={styles.tile} aria-label="Upcoming assessments" aria-describedby={descriptionId} aria-haspopup="dialog"
    onClick={(event) => {
      event.currentTarget.focus({ preventScroll: true });
      const { left, top, width, height } = event.currentTarget.getBoundingClientRect();
      onOpen({ left, top, width, height });
    }}>
    <span className={styles.datePage} aria-hidden="true">
      <span className={styles.month}>{new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(parseDate(date))}</span>
      <strong>{Number(date.slice(-2))}</strong>
      <span className={styles.weekday}>{new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(parseDate(date))}</span>
    </span>
    <span className={styles.tileLabel}>Upcoming <br />assessments
      <span id={descriptionId} className={styles.tileCount}>
        {unavailable ? "Unavailable" : <><b>{count >= 8 ? "8+" : count}</b><span>Next 7 days</span></>}
        <ArrowRight size={18} aria-hidden="true" />
      </span>
    </span>
  </button>;
}

export default function HomeAssessmentCalendar({ viewer, refreshKey, origin, onClose, onOpenPacket }: {
  viewer: HomeBriefingSnapshot["viewer"];
  refreshKey: string;
  origin: HomeDialogOrigin;
  onClose: () => void;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">, location?: PipelineWorkspaceLocation, action?: AssessmentEntryAction) => void;
}) {
  const [anchor, setAnchor] = useState(todayKey);
  const [retry, setRetry] = useState(0);
  const generation = usePipelineDataGeneration();
  const range = calendarRange("week", anchor);
  const requestKey = `${viewer.id}:${generation}:${range.from}:${range.to}`;
  const [snapshot, setSnapshot] = useState<{ key: string; events: PipelineCalendarEvent[]; error?: string } | null>(null);
  const current = snapshot?.key === requestKey ? snapshot : null;
  const loading = !current;
  const days = dateKeys(range.from, range.to);
  const today = todayKey();
  const grouped = groupEventsByDate(current?.events ?? []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ from: range.from, to: range.to, include_assignments: "false", queue_mine: "true", queue_limit: "1" });
    void Promise.all([
      fetchPipelineJson<PipelineCalendarResponse>(`/api/calendar/events?${params}`, { cache: "no-store", signal: controller.signal }),
      fetchCurrentPipelineUser(),
    ]).then(([payload, { user }]) => {
      if (controller.signal.aborted) return;
      if (payload.viewer.id !== viewer.id || user.id !== viewer.id) throw new Error("Calendar user changed.");
      // The full calendar may contain team events for coordinators. Home is
      // personal, including legacy name ownership, just like its upcoming list.
      const events = payload.events.filter(event => event.kind === "assessment"
        && event.date >= range.from && event.date <= range.to
        && isAssignedToUser(event, { id: viewer.id, name: user.name, email: user.email }))
        .sort((a, b) => (a.startsAt ?? a.date).localeCompare(b.startsAt ?? b.date) || a.clientName.localeCompare(b.clientName));
      setSnapshot({ key: requestKey, events });
    }).catch(() => {
      if (!controller.signal.aborted) setSnapshot({ key: requestKey, events: [], error: "Upcoming assessments are unavailable." });
    });
    return () => controller.abort();
  }, [requestKey, range.from, range.to, viewer.id, refreshKey, retry]);

  return <HomeDialog label="Upcoming assessments" title="Upcoming assessments" size="browser" className={styles.dialog} expandFrom={origin} onClose={onClose}>
    <div className={styles.toolbar}>
      <div className={styles.range} aria-live="polite"><strong>{rangeLabel("week", range)}</strong><span>{range.from.slice(0, 4)}{range.to.slice(0, 4) !== range.from.slice(0, 4) ? `–${range.to.slice(0, 4)}` : ""} · Pacific time</span></div>
      <div className={styles.navigation}>
        <button type="button" aria-label="Previous calendar range" onClick={() => setAnchor(value => shiftAnchor("week", value, -1))}><ArrowLeft size={18} aria-hidden="true" /></button>
        <button type="button" onClick={() => setAnchor(today)}>Today</button>
        <button type="button" aria-label="Next calendar range" onClick={() => setAnchor(value => shiftAnchor("week", value, 1))}><ArrowRight size={18} aria-hidden="true" /></button>
      </div>
    </div>
    <div className={styles.content} aria-busy={loading}>
      {current?.error ? <div role="alert" className={styles.notice}>{current.error}<button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></div> : <>
        {loading ? <p role="status" className={styles.notice}>Loading assessments…</p> : current?.events.length === 0 ? <p role="status" className={styles.notice}>No assessments scheduled this week.</p> : null}
        <div className={styles.week} key={range.from} data-assessment-week>
          {days.map(day => <section key={day} className={styles.day} aria-label={longDate(day)} data-calendar-day={day} data-today={day === today || undefined}>
            <h3 className={styles.dayHeading}><span>{new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(parseDate(day))}</span><time dateTime={day} aria-current={day === today ? "date" : undefined}>{Number(day.slice(-2))}</time></h3>
            <div className={styles.appointments}>
              {grouped.get(day)?.map(event => {
                const next = assessmentEventNextStep(event);
                const name = formatClientIdentityTitle({ name: event.clientName, community: event.community });
                return <button key={event.id} type="button" className={styles.appointment} data-complete={event.status === "complete" || undefined} title={next.label}
                  onClick={() => {
                    onClose();
                    onOpenPacket({ id: event.referralId, name, community: event.community as Referral["community"] }, { view: "assessment" }, next.entry);
                  }}>
                  <time dateTime={event.startsAt}>{eventTime(event.startsAt)}</time>
                  <strong>{name}</strong><span>{event.community}</span>
                  <span className={styles.method}>{methodLabel(event.method)}<ArrowRight size={16} aria-hidden="true" /></span>
                  {event.status === "complete" ? <span>Completed</span> : null}
                </button>;
              }) ?? <span className={styles.openDay} aria-hidden="true">—</span>}
            </div>
          </section>)}
        </div>
      </>}
    </div>
  </HomeDialog>;
}
