"use client";

import React, { useMemo, useState } from "react";
import { CircleAlert, GripVertical, X } from "lucide-react";

const stages = [
  "New",
  "Contacted",
  "Awaiting Packet",
  "In Review",
  "Scheduled",
  "Routed",
];

const priorities = {
  urgent: { label: "Urgent", tone: "border-l-red-400 text-red-700" },
  high: { label: "High", tone: "border-l-amber-400 text-amber-700" },
  medium: { label: "Medium", tone: "border-l-slate-300 text-slate-600" },
  low: { label: "Low", tone: "border-l-slate-200 text-slate-500" },
} as const;

const workflowGroups = [
  {
    title: "Triage",
    description: "New intake and first outreach",
    stages: ["New", "Contacted"],
    shellTone: "border-sky-200 bg-sky-50/35",
    headerTone: "border-sky-200 bg-sky-50/60",
    badgeTone: "border-sky-200 bg-white text-sky-700",
  },
  {
    title: "Packet Review",
    description: "Collect documents and complete review",
    stages: ["Awaiting Packet", "In Review"],
    shellTone: "border-violet-200 bg-violet-50/35",
    headerTone: "border-violet-200 bg-violet-50/60",
    badgeTone: "border-violet-200 bg-white text-violet-700",
  },
  {
    title: "Disposition",
    description: "Schedule, route, and hand off",
    stages: ["Scheduled", "Routed"],
    shellTone: "border-amber-200 bg-amber-50/35",
    headerTone: "border-amber-200 bg-amber-50/60",
    badgeTone: "border-amber-200 bg-white text-amber-700",
  },
] as const;

const railColumns = "xl:grid-cols-[1fr_1fr_0.9fr]";

const mockReferrals = [
  {
    id: 1,
    name: "Robert Thompson",
    stage: "New",
    source: "County General ED",
    priority: "urgent",
    contact: "555-0123",
    email: "rthompson@email.com",
    age: 32,
    gender: "M",
    diagnosis: "Suicidal ideation, depression",
    packetSummary: "ED note attached, med list missing, psych consult pending",
    packetReady: false,
    created: "2026-04-08",
    lastContact: "Apr 8, 8:15 AM",
    assignedTo: "",
    notes: "ED referral with active safety concerns.",
    medicalClearance: "Pending",
    serviceType: "Memory Care",
  },
  {
    id: 2,
    name: "Patricia Martinez",
    stage: "Awaiting Packet",
    source: "Family Direct",
    priority: "medium",
    contact: "555-0456",
    email: "pmartinez@email.com",
    age: 45,
    gender: "F",
    diagnosis: "Bipolar I disorder",
    packetSummary: "Clinical summary received, consent packet missing",
    packetReady: false,
    created: "2026-04-06",
    lastContact: "Apr 9, 9:00 AM",
    assignedTo: "David Chen, LCSW",
    notes: "Family wants status update after packet request.",
    medicalClearance: "Not started",
    serviceType: "Assisted Living",
  },
  {
    id: 3,
    name: "David Garcia",
    stage: "Contacted",
    source: "Community Event",
    priority: "low",
    contact: "555-0789",
    email: "dgarcia@email.com",
    age: 28,
    gender: "M",
    diagnosis: "Anxiety disorder",
    packetSummary: "Initial intake note only",
    packetReady: false,
    created: "2026-04-09",
    lastContact: "Apr 9, 10:30 AM",
    assignedTo: "Sarah Johnson, RN",
    notes: "Community follow-up call completed.",
    medicalClearance: "Not started",
    serviceType: "Independent Living",
  },
  {
    id: 4,
    name: "Mary Robinson",
    stage: "In Review",
    source: "Physician Referral",
    priority: "high",
    contact: "555-0321",
    email: "mrobinson@email.com",
    age: 67,
    gender: "F",
    diagnosis: "Major depression",
    packetSummary: "Packet scanned, clinician review underway",
    packetReady: true,
    created: "2026-04-05",
    lastContact: "Apr 9, 11:45 AM",
    assignedTo: "Michael Lee, LMFT",
    notes: "Awaiting final clinical recommendation.",
    medicalClearance: "Cleared",
    serviceType: "Skilled Nursing",
  },
  {
    id: 5,
    name: "James Wilson",
    stage: "Scheduled",
    source: "Physician Referral",
    priority: "high",
    contact: "555-0654",
    email: "jwilson@email.com",
    age: 55,
    gender: "M",
    diagnosis: "Schizophrenia",
    packetSummary: "Packet complete and accepted",
    packetReady: true,
    created: "2026-04-04",
    lastContact: "Apr 9, 1:20 PM",
    assignedTo: "Sarah Johnson, RN",
    notes: "Assessment scheduled for tomorrow morning.",
    medicalClearance: "Cleared",
    serviceType: "Skilled Nursing",
  },
  {
    id: 6,
    name: "Linda Anderson",
    stage: "Routed",
    source: "Website Inquiry",
    priority: "medium",
    contact: "555-0987",
    email: "landerson@email.com",
    age: 72,
    gender: "F",
    diagnosis: "Dementia",
    packetSummary: "Ready for placement handoff",
    packetReady: true,
    created: "2026-04-03",
    lastContact: "Apr 9, 2:15 PM",
    assignedTo: "David Chen, LCSW",
    notes: "Matched to Santa Clarita pending family confirmation.",
    medicalClearance: "Cleared",
    serviceType: "Independent Living",
  },
];

type Referral = (typeof mockReferrals)[number];
type PriorityKey = keyof typeof priorities;

interface PipelineOverviewProps {
  searchTerm: string;
}

export default function PipelineOverview({ searchTerm }: PipelineOverviewProps) {
  const [referrals, setReferrals] = useState(mockReferrals);
  const [draggedItem, setDraggedItem] = useState<Referral | null>(null);
  const [selectedReferral, setSelectedReferral] = useState<Referral | null>(null);

  const filteredReferrals = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return term
      ? referrals.filter(
          (referral) =>
            referral.name.toLowerCase().includes(term) ||
            referral.source.toLowerCase().includes(term) ||
            referral.assignedTo.toLowerCase().includes(term),
        )
      : referrals;
  }, [referrals, searchTerm]);

  const counts = stages.reduce((acc, stage) => {
    acc[stage] = referrals.filter((r) => r.stage === stage).length;
    return acc;
  }, {} as Record<string, number>);

  const needsReview = referrals
    .filter((r) => r.priority === "urgent" || r.priority === "high")
    .sort(sortByAge)
    .slice(0, 4);

  const missingPacketItems = referrals
    .filter((r) => !r.packetReady)
    .sort(sortByAge)
    .slice(0, 4);

  const staleReferrals = referrals
    .filter((referral) => formatAgeDays(referral.created) >= 2)
    .sort(sortByAge)
    .slice(0, 4);

  const handleDragStart = (
    event: React.DragEvent<HTMLDivElement>,
    referral: Referral,
  ) => {
    setDraggedItem(referral);
    event.dataTransfer.effectAllowed = "move";
  };

  const handleDrop = (
    event: React.DragEvent<HTMLDivElement>,
    newStage: string,
  ) => {
    event.preventDefault();
    if (!draggedItem) return;

    setReferrals((current) =>
      current.map((referral) =>
        referral.id === draggedItem.id
          ? { ...referral, stage: newStage }
          : referral,
      ),
    );
    setDraggedItem(null);
  };

  const updateReferral = (id: number, updates: Partial<Referral>) => {
    setReferrals((current) =>
      current.map((referral) =>
        referral.id === id ? { ...referral, ...updates } : referral,
      ),
    );
    setSelectedReferral((current) =>
      current?.id === id ? { ...current, ...updates } : current,
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <section className={`grid shrink-0 gap-3 ${railColumns}`}>
        <ActionRail
          title="Needs review"
          items={needsReview}
          emptyLabel="No referrals awaiting review"
          actionLabel="Assign"
          actionForItem={(item) =>
            updateReferral(item.id, { assignedTo: item.assignedTo || "Andrew Dominici" })
          }
          secondaryLabel={(item) =>
            `${item.source} · ${item.serviceType} · ${formatAge(item.created)} open`
          }
          secondaryTone="text-slate-600"
          onSelect={setSelectedReferral}
        />

        <ActionRail
          title="Missing packet items"
          items={missingPacketItems}
          emptyLabel="No packet requests outstanding"
          actionLabel="Request items"
          actionForItem={(item) =>
            updateReferral(item.id, {
              notes: `${item.notes} Packet reminder sent.`,
              lastContact: "Just now",
            })
          }
          secondaryLabel={(item) => item.packetSummary}
          secondaryTone="text-slate-500"
          onSelect={setSelectedReferral}
        />

        <ActionRail
          title="Stale referrals"
          items={staleReferrals}
          emptyLabel="No stale referrals in queue"
          actionLabel="Nudge"
          actionForItem={(item) =>
            updateReferral(item.id, {
              lastContact: "Just now",
              notes: `${item.notes} Follow-up sent.`,
            })
          }
          secondaryLabel={(item) => `${formatAge(item.created)} open · ${getBlockerText(item)}`}
          secondaryTone="text-slate-500"
          onSelect={setSelectedReferral}
        />
      </section>

      <section className="flex min-h-0 flex-1 flex-col rounded-2xl border-2 border-slate-200 bg-white">
        <div className="flex shrink-0 items-center justify-between border-b-2 border-slate-200 px-4 py-3">
          <div className="text-[13px] font-medium text-slate-900">
            Admissions board
          </div>
          <div className="text-[12px] text-slate-500">
            Grouped by workflow phase for faster scanning
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 overflow-auto p-3 xl:grid-cols-3">
          {workflowGroups.map((group) => (
            <div
              key={group.title}
              className={`flex min-h-0 flex-col rounded-2xl border-2 ${group.shellTone}`}
            >
              <div className={`border-b-2 px-4 py-3 ${group.headerTone}`}>
                <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
                  {group.title}
                </div>
                <div className="mt-1 text-[12px] text-slate-500">
                  {group.description}
                </div>
              </div>

              <div className="grid min-h-0 flex-1 gap-3 p-3">
                {group.stages.map((stage) => {
                  const stageItems = filteredReferrals
                    .filter((referral) => referral.stage === stage)
                    .sort(sortByAge);

                  return (
                    <div
                      key={stage}
                      className="flex min-h-0 flex-col rounded-2xl border-2 border-indigo-100 bg-white"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => handleDrop(event, stage)}
                    >
                      <div className={`flex items-center justify-between border-b-2 px-3 py-2.5 ${group.headerTone}`}>
                        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
                          {stage}
                        </div>
                        <span className={`rounded-lg border-2 px-2 py-1 text-[11px] font-medium ${group.badgeTone}`}>
                          {counts[stage] || 0}
                        </span>
                      </div>

                      <div className="flex-1 space-y-2 overflow-auto p-2">
                        {stageItems.length === 0 ? (
                          <div className="flex h-24 items-center justify-center rounded-2xl border-2 border-dashed border-indigo-100 bg-indigo-50/20 px-3 text-center text-[12px] text-slate-400">
                            No referrals here
                          </div>
                        ) : (
                          stageItems.map((referral) => (
                            <div
                              key={referral.id}
                              draggable
                              onDragStart={(event) => handleDragStart(event, referral)}
                              onClick={() => setSelectedReferral(referral)}
                              className="group cursor-move rounded-2xl border-2 border-slate-200 bg-white p-3 transition-colors hover:border-indigo-200"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex min-w-0 items-start gap-2">
                                  <GripVertical
                                    size={13}
                                    className="mt-0.5 shrink-0 text-slate-300 transition-colors group-hover:text-slate-700"
                                  />
                                  <div className="min-w-0">
                                    <div className="truncate text-[12px] font-medium text-slate-900">
                                      {referral.name}
                                    </div>
                                    <div className="mt-1 text-[12px] text-slate-500">
                                      {referral.source}
                                    </div>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="text-[12px] font-medium text-slate-900">
                                    {formatAge(referral.created)}
                                  </div>
                                  <div
                                    className={`mt-1 border-l-2 pl-2 text-[10px] font-medium uppercase tracking-[0.12em] ${priorities[referral.priority as PriorityKey].tone}`}
                                  >
                                    {priorities[referral.priority as PriorityKey].label}
                                  </div>
                                </div>
                              </div>

                              <div className="mt-2.5 space-y-2">
                                <div className="rounded-xl border-2 border-indigo-100 bg-indigo-50/20 px-3 py-2">
                                  <div className="flex items-center justify-between gap-3 text-[11px]">
                                    <span
                                      className={`border-l-2 pl-2 font-medium ${
                                        referral.packetReady
                                          ? "border-indigo-400 text-slate-700"
                                          : "border-amber-400 text-slate-700"
                                      }`}
                                    >
                                      {referral.packetReady ? "Packet ready" : "Packet missing"}
                                    </span>
                                    <span className="truncate text-slate-500">
                                      {referral.assignedTo || "Unassigned"}
                                    </span>
                                  </div>
                                </div>

                                <div className="border-t-2 border-slate-200 pt-2">
                                  <div className="text-[11px] leading-5 text-slate-600">
                                    {getBlockerText(referral)}
                                  </div>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                  {renderStageAction(referral, updateReferral)}
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {selectedReferral ? (
        <div
          className="fixed inset-0 z-50 bg-black/40 p-4"
          onClick={() => setSelectedReferral(null)}
        >
          <div
            className="ml-auto flex h-full w-full max-w-[420px] flex-col overflow-auto rounded-2xl border border-slate-200 bg-white"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                  Referral detail
                </div>
                <h2 className="mt-1 text-lg font-medium text-slate-900">
                  {selectedReferral.name}
                </h2>
              </div>
              <button
                onClick={() => setSelectedReferral(null)}
                className="text-slate-400 transition-colors hover:text-slate-700"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 p-4">
              <StageGuidance
                referral={selectedReferral}
                onAdvance={(updates) => updateReferral(selectedReferral.id, updates)}
              />

              <DetailBlock label="Stage" value={selectedReferral.stage} />
              <DetailBlock
                label="Priority"
                value={priorities[selectedReferral.priority as PriorityKey].label}
              />
              <DetailBlock label="Source" value={selectedReferral.source} />
              <DetailBlock
                label="Assigned"
                value={selectedReferral.assignedTo || "Unassigned"}
              />
              <DetailBlock
                label="Packet summary"
                value={selectedReferral.packetSummary}
              />
              <DetailBlock
                label="Medical clearance"
                value={selectedReferral.medicalClearance}
              />
              <ContextPanel
                title="Packet context"
                rows={getPacketContext(selectedReferral)}
              />
              <ContextPanel
                title="Routing context"
                rows={getRoutingContext(selectedReferral)}
              />
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                  <CircleAlert size={14} className="text-slate-700" />
                  Notes
                </div>
                <div className="text-[12px] leading-6 text-slate-600">
                  {selectedReferral.notes}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ActionRail({
  title,
  items,
  emptyLabel,
  actionLabel,
  actionForItem,
  secondaryLabel,
  secondaryTone,
  onSelect,
}: {
  title: string;
  items: Referral[];
  emptyLabel: string;
  actionLabel: string;
  actionForItem: (item: Referral) => void;
  secondaryLabel: (item: Referral) => string;
  secondaryTone: string;
  onSelect: (item: Referral) => void;
}) {
  return (
    <div className="rounded-2xl border-2 border-slate-200 bg-white px-4 py-3">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
        {title}
      </div>
      {items.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-indigo-100 bg-indigo-50/20 px-3 py-6 text-center text-[12px] text-slate-400">
          {emptyLabel}
        </div>
      ) : (
        <div className="divide-y divide-slate-200">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 py-2.5">
              <button className="min-w-0 text-left" onClick={() => onSelect(item)}>
                <div className="truncate text-[12px] font-medium text-slate-900">
                  {item.name}
                </div>
                <div className={`mt-1 truncate text-[12px] ${secondaryTone}`}>
                  {secondaryLabel(item)}
                </div>
              </button>
              <button
                onClick={() => actionForItem(item)}
                className="shrink-0 rounded-xl border-2 border-indigo-200 bg-indigo-50/40 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 transition-colors hover:bg-indigo-50/60"
              >
                {actionLabel}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border-2 border-slate-200 bg-slate-50/40 p-4">
      <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-[12px] text-slate-700">{value}</div>
    </div>
  );
}

function ContextPanel({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="rounded-2xl border-2 border-slate-200 bg-white">
      <div className="border-b-2 border-slate-200 px-4 py-3 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
        {title}
      </div>
      <div className="divide-y divide-slate-200">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-4 px-4 py-3">
            <div className="text-[11px] text-slate-500">{row.label}</div>
            <div className="text-right text-[11px] text-slate-700">{row.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StageGuidance({
  referral,
  onAdvance,
}: {
  referral: Referral;
  onAdvance: (updates: Partial<Referral>) => void;
}) {
  const config = getStageGuidance(referral);

  return (
    <div className="rounded-2xl border-2 border-slate-200 bg-white">
      <div className="border-b-2 border-slate-200 px-4 py-3">
        <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
          Next best action
        </div>
        <div className="mt-1 text-[12px] text-slate-700">{config.title}</div>
        <div className="mt-1 text-[11px] text-slate-500">{config.description}</div>
      </div>
      <div className="flex flex-wrap gap-2 p-3">
        {config.actions.map((action) => (
          <button
            key={action.label}
            onClick={() => onAdvance(action.updates)}
            className={`rounded-xl px-3 py-2 text-[11px] font-medium transition-colors ${
              action.primary
                ? "app-gradient-button text-white"
                : "border-2 border-indigo-200 bg-indigo-50/40 text-slate-700 hover:bg-indigo-50/60"
            }`}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function formatAge(createdAt: string) {
  const ageInDays = formatAgeDays(createdAt);
  return ageInDays === 0 ? "Today" : `${ageInDays}d`;
}

function formatAgeDays(createdAt: string) {
  return Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(`${createdAt}T12:00:00`).getTime()) /
        (1000 * 60 * 60 * 24),
    ),
  );
}

function sortByAge(a: Referral, b: Referral) {
  return new Date(a.created).getTime() - new Date(b.created).getTime();
}

function getBlockerText(referral: Referral) {
  if (referral.stage === "New") {
    return referral.assignedTo ? "First outreach still pending." : "No owner assigned yet.";
  }

  if (referral.stage === "Contacted") {
    return referral.packetReady
      ? "Packet review has not started."
      : "Packet request has not been completed.";
  }

  if (referral.stage === "Awaiting Packet") {
    return "Packet is still incomplete.";
  }

  if (referral.stage === "In Review") {
    return "Clinical recommendation is still pending.";
  }

  if (referral.stage === "Scheduled") {
    return "Assessment must be completed before routing.";
  }

  return "Awaiting final community confirmation.";
}

function getPacketContext(referral: Referral) {
  return [
    {
      label: "Packet status",
      value: referral.packetReady ? "Ready for review" : "Still incomplete",
    },
    {
      label: "Last outreach",
      value: referral.lastContact,
    },
    {
      label: "Missing / summary",
      value: referral.packetSummary,
    },
  ];
}

function getRoutingContext(referral: Referral) {
  const communityMatch =
    referral.serviceType === "Independent Living"
      ? "Santa Clarita · strong fit"
      : referral.serviceType === "Skilled Nursing"
        ? "San Francisco · review capacity"
        : "San Pablo · initial fit";

  const blocker =
    referral.stage === "Awaiting Packet"
      ? "Packet still incomplete"
      : referral.stage === "In Review"
        ? "Clinical recommendation pending"
        : referral.stage === "Scheduled"
          ? "Assessment slot pending completion"
          : referral.stage === "Routed"
            ? "Awaiting community confirmation"
            : "No placement blocker recorded";

  return [
    { label: "Suggested community", value: communityMatch },
    { label: "Current blocker", value: blocker },
    { label: "Service line", value: referral.serviceType },
  ];
}

function getStageGuidance(referral: Referral) {
  if (referral.stage === "New") {
    return {
      title: "Take ownership and start outreach",
      description: "Unowned referrals should be assigned and contacted immediately.",
      actions: [
        {
          label: "Assign to me",
          updates: { assignedTo: "Andrew Dominici" },
          primary: false,
        },
        {
          label: "Mark contacted",
          updates: {
            stage: "Contacted",
            assignedTo: referral.assignedTo || "Andrew Dominici",
            lastContact: "Just now",
          },
          primary: true,
        },
      ],
    };
  }

  if (referral.stage === "Contacted") {
    return {
      title: "Push the packet request forward",
      description: "Once first contact is complete, collect the required packet items.",
      actions: [
        {
          label: "Request packet",
          updates: {
            stage: "Awaiting Packet",
            lastContact: "Just now",
            notes: `${referral.notes} Packet request sent.`,
          },
          primary: true,
        },
      ],
    };
  }

  if (referral.stage === "Awaiting Packet") {
    return {
      title: "Close packet gaps",
      description: "The fastest way forward is usually a focused packet follow-up.",
      actions: [
        {
          label: "Request missing items",
          updates: { lastContact: "Just now" },
          primary: false,
        },
        {
          label: "Mark packet ready",
          updates: {
            packetReady: true,
            stage: "In Review",
            packetSummary: "Packet complete and ready for review",
          },
          primary: true,
        },
      ],
    };
  }

  if (referral.stage === "In Review") {
    return {
      title: "Finalize packet review",
      description: "This referral is waiting on clinician review or scheduling.",
      actions: [
        {
          label: "Send to scheduling",
          updates: { stage: "Scheduled" },
          primary: true,
        },
      ],
    };
  }

  if (referral.stage === "Scheduled") {
    return {
      title: "Complete assessment and route",
      description: "The next milestone is routing to the right community.",
      actions: [
        {
          label: "Route to community",
          updates: { stage: "Routed" },
          primary: true,
        },
      ],
    };
  }

  return {
    title: "Track handoff and confirmation",
    description: "Routing is complete; monitor confirmation and follow-through.",
    actions: [
      {
        label: "Add follow-up note",
        updates: { lastContact: "Just now" },
        primary: false,
      },
    ],
  };
}

function renderStageAction(
  referral: Referral,
  updateReferral: (id: number, updates: Partial<Referral>) => void,
) {
  if (referral.stage === "New") {
    return (
      <button
        onClick={(event) => {
          event.stopPropagation();
          updateReferral(referral.id, {
            stage: "Contacted",
            assignedTo: referral.assignedTo || "Andrew Dominici",
            lastContact: "Just now",
          });
        }}
        className="rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-[10px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
      >
        Mark contacted
      </button>
    );
  }

  if (referral.stage === "Awaiting Packet") {
    return (
      <button
        onClick={(event) => {
          event.stopPropagation();
          updateReferral(referral.id, { lastContact: "Just now" });
        }}
        className="rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-[10px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
      >
        Request items
      </button>
    );
  }

  if (referral.stage === "In Review") {
    return (
      <button
        onClick={(event) => {
          event.stopPropagation();
          updateReferral(referral.id, { stage: "Scheduled" });
        }}
        className="rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-[10px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
      >
        Schedule
      </button>
    );
  }

  if (referral.stage === "Scheduled") {
    return (
      <button
        onClick={(event) => {
          event.stopPropagation();
          updateReferral(referral.id, { stage: "Routed" });
        }}
        className="rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-[10px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
      >
        Route
      </button>
    );
  }

  return (
    <button
      onClick={(event) => {
        event.stopPropagation();
      }}
      className="rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-[10px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
    >
      Open
    </button>
  );
}
