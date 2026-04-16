"use client";

import React, { useMemo, useState } from "react";
import {
  Download,
  Eye,
  Filter,
  Mail,
  Phone,
  UserPlus,
  X,
} from "lucide-react";

const stages = [
  "All",
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
    created: "2026-04-08",
    assignedTo: "",
    serviceType: "Memory Care",
    packetStatus: "Missing",
    lastTouched: "Apr 8, 8:15 AM",
    notes: "High-risk referral, no assigned owner yet.",
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
    created: "2026-04-06",
    assignedTo: "David Chen",
    serviceType: "Assisted Living",
    packetStatus: "Partial",
    lastTouched: "Apr 9, 9:00 AM",
    notes: "Waiting on signed consents.",
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
    created: "2026-04-09",
    assignedTo: "Sarah Johnson",
    serviceType: "Independent Living",
    packetStatus: "Missing",
    lastTouched: "Apr 9, 10:30 AM",
    notes: "First outreach completed.",
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
    created: "2026-04-05",
    assignedTo: "Michael Lee",
    serviceType: "Skilled Nursing",
    packetStatus: "Complete",
    lastTouched: "Apr 9, 11:45 AM",
    notes: "Clinician review in progress.",
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
    created: "2026-04-04",
    assignedTo: "Sarah Johnson",
    serviceType: "Skilled Nursing",
    packetStatus: "Complete",
    lastTouched: "Apr 9, 1:20 PM",
    notes: "Assessment scheduled tomorrow.",
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
    created: "2026-04-03",
    assignedTo: "David Chen",
    serviceType: "Independent Living",
    packetStatus: "Complete",
    lastTouched: "Apr 9, 2:15 PM",
    notes: "Routed to Santa Clarita.",
  },
  {
    id: 7,
    name: "Michael Brown",
    stage: "New",
    source: "Hospital Discharge",
    priority: "high",
    contact: "555-0147",
    email: "mbrown@email.com",
    age: 58,
    gender: "M",
    created: "2026-04-07",
    assignedTo: "",
    serviceType: "Memory Care",
    packetStatus: "Missing",
    lastTouched: "Apr 8, 4:10 PM",
    notes: "Needs assignment and packet request.",
  },
  {
    id: 8,
    name: "Susan Taylor",
    stage: "Contacted",
    source: "Family Direct",
    priority: "medium",
    contact: "555-0258",
    email: "staylor@email.com",
    age: 63,
    gender: "F",
    created: "2026-04-06",
    assignedTo: "David Chen",
    serviceType: "Assisted Living",
    packetStatus: "Partial",
    lastTouched: "Apr 9, 12:20 PM",
    notes: "Follow-up call scheduled for packet review.",
  },
];

type Referral = (typeof mockReferrals)[number];
type PriorityKey = keyof typeof priorities;
type QueueFilter = "all" | "missing" | "unassigned" | "stale";

interface ReferralsProps {
  searchTerm: string;
}

export default function Referrals({ searchTerm }: ReferralsProps) {
  const [referrals, setReferrals] = useState(mockReferrals);
  const [filterStage, setFilterStage] = useState("All");
  const [filterPriority, setFilterPriority] = useState("All");
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
  const [selectedReferral, setSelectedReferral] = useState<Referral | null>(
    mockReferrals[0],
  );

  const filteredReferrals = useMemo(() => {
    const term = searchTerm.toLowerCase();

    return [...referrals]
      .filter((referral) => {
        const matchesSearch =
          referral.name.toLowerCase().includes(term) ||
          referral.source.toLowerCase().includes(term) ||
          referral.assignedTo.toLowerCase().includes(term);
        const matchesStage =
          filterStage === "All" || referral.stage === filterStage;
        const matchesPriority =
          filterPriority === "All" || referral.priority === filterPriority;
        const matchesQueueFilter =
          queueFilter === "all"
            ? true
            : queueFilter === "missing"
              ? referral.packetStatus !== "Complete"
              : queueFilter === "unassigned"
                ? !referral.assignedTo
                : formatAgeDays(referral.created) >= 2;

        return matchesSearch && matchesStage && matchesPriority && matchesQueueFilter;
      })
      .sort((a, b) => {
        const priorityRank = { urgent: 0, high: 1, medium: 2, low: 3 };
        const priorityDelta =
          priorityRank[a.priority as PriorityKey] - priorityRank[b.priority as PriorityKey];

        if (priorityDelta !== 0) return priorityDelta;
        return new Date(a.created).getTime() - new Date(b.created).getTime();
      });
  }, [filterPriority, filterStage, queueFilter, referrals, searchTerm]);

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

  const selected =
    filteredReferrals.find((referral) => referral.id === selectedReferral?.id) ??
    selectedReferral;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex shrink-0 items-center justify-between">
        <div className="text-[12px] text-slate-500">
          Sorted by urgency, oldest untouched first
        </div>
        <button className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/40 px-3 py-2 text-[12px] font-medium text-slate-700 transition-colors hover:bg-indigo-50/60">
          <Download size={14} />
          Export queue
        </button>
      </div>

      <div className="rounded-2xl border-2 border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b-2 border-slate-200 px-4 py-3">
          <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
            Intake controls
          </div>
          <div className="text-[12px] text-slate-500">
            {filteredReferrals.length} referrals in view
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 p-3">
          <div className="mr-1 flex items-center gap-2 text-[12px] text-slate-500">
            <Filter size={14} />
            Queue
          </div>
          {[
            { id: "all", label: "All" },
            { id: "missing", label: "Needs packet" },
            { id: "unassigned", label: "Unassigned" },
            { id: "stale", label: "Stale" },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setQueueFilter(item.id as QueueFilter)}
              className={`rounded-xl border px-3 py-2 text-[12px] font-medium transition-colors ${
                queueFilter === item.id
                  ? "border-indigo-200 bg-indigo-50/40 text-slate-900"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {item.label}
            </button>
          ))}
          <select
            value={filterStage}
            onChange={(event) => setFilterStage(event.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-700 outline-none focus:ring-2 focus:ring-slate-200"
          >
            {stages.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
          <select
            value={filterPriority}
            onChange={(event) => setFilterPriority(event.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-700 outline-none focus:ring-2 focus:ring-slate-200"
          >
            <option value="All">All priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-h-0 overflow-hidden rounded-2xl border-2 border-slate-200 bg-white">
          <div className="border-b-2 border-slate-200 px-4 py-3 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
            Intake worklist
          </div>
          <div className="h-full overflow-auto">
            <table className="w-full">
              <thead className="sticky top-0 border-b-2 border-slate-200 bg-slate-50/80">
                <tr>
                  <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
                    Person
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
                    Stage
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
                    Packet
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
                    Owner
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
                    Age
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredReferrals.map((referral) => (
                  <tr
                    key={referral.id}
                    className={`cursor-pointer transition-colors hover:bg-slate-50 ${
                      selected?.id === referral.id ? "bg-indigo-50/35" : ""
                    }`}
                    onClick={() => setSelectedReferral(referral)}
                  >
                    <td className="px-4 py-3">
                      <div className="text-[12px] font-medium text-slate-900">
                        {referral.name}
                      </div>
                      <div className="mt-1 text-[12px] text-slate-500">
                        {referral.source} · {referral.serviceType}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full border-2 border-indigo-200 bg-indigo-50/35 px-2.5 py-1 text-[10px] font-medium text-slate-700">
                        {referral.stage}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`border-l-2 pl-2 text-[12px] font-medium ${
                          referral.packetStatus === "Complete"
                            ? "border-l-indigo-400 text-slate-700"
                            : "border-l-amber-400 text-slate-700"
                        }`}
                      >
                        {referral.packetStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-slate-700">
                      {referral.assignedTo || "Unassigned"}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-slate-500">
                      {formatAge(referral.created)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedReferral(referral);
                        }}
                        className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
                      >
                        <Eye size={12} />
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="min-h-0 overflow-auto rounded-2xl border-2 border-slate-200 bg-white">
          {selected ? (
            <div className="space-y-3 p-4">
              <div className="flex items-start justify-between border-b-2 border-slate-200 pb-3">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                    Quick review
                  </div>
                  <h2 className="mt-1 text-[16px] font-medium text-slate-900">
                    {selected.name}
                  </h2>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {selected.age}
                    {selected.gender} · {selected.contact}
                  </div>
                </div>
                <button
                  onClick={() => setSelectedReferral(null)}
                  className="text-slate-400 transition-colors hover:text-slate-700"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <InfoPanel label="Stage" value={selected.stage} />
                <InfoPanel
                  label="Priority"
                  value={priorities[selected.priority as PriorityKey].label}
                />
                <InfoPanel label="Packet" value={selected.packetStatus} />
                <InfoPanel
                  label="Owner"
                  value={selected.assignedTo || "Unassigned"}
                />
              </div>

              <div className="rounded-2xl border-2 border-slate-200 bg-white">
                <div className="border-b-2 border-slate-200 px-4 py-3 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                  Next actions
                </div>
                <div className="flex flex-wrap gap-2 p-3">
                  <button
                    onClick={() =>
                      updateReferral(selected.id, {
                        assignedTo: selected.assignedTo || "Andrew Dominici",
                      })
                    }
                    className="inline-flex items-center gap-2 rounded-xl border-2 border-indigo-200 bg-indigo-50/35 px-3 py-2 text-[12px] font-medium text-slate-700 transition-colors hover:bg-indigo-50/60"
                  >
                    <UserPlus size={14} />
                    Assign
                  </button>
                  <button
                    onClick={() =>
                      updateReferral(selected.id, {
                        packetStatus: "Partial",
                        lastTouched: "Just now",
                      })
                    }
                    className="rounded-xl border-2 border-indigo-200 bg-indigo-50/35 px-3 py-2 text-[12px] font-medium text-slate-700 transition-colors hover:bg-indigo-50/60"
                  >
                    Request packet
                  </button>
                  <button
                    onClick={() =>
                      updateReferral(selected.id, {
                        stage:
                          selected.stage === "New" ? "Contacted" : selected.stage,
                        lastTouched: "Just now",
                      })
                    }
                    className="rounded-xl border-2 border-indigo-200 bg-indigo-50/35 px-3 py-2 text-[12px] font-medium text-slate-700 transition-colors hover:bg-indigo-50/60"
                  >
                    Mark contacted
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border-2 border-slate-200 bg-white p-4">
                <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                  Notes
                </div>
                <div className="mt-2 text-[12px] leading-6 text-slate-600">
                  {selected.notes}
                </div>
                <div className="mt-3 text-[12px] text-slate-500">
                  Last touched {selected.lastTouched}
                </div>
              </div>

              <div className="grid gap-2">
                <button
                  onClick={() => (window.location.href = `tel:${selected.contact}`)}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <Phone size={14} />
                  Call referral source
                </button>
                <button
                  onClick={() => (window.location.href = `mailto:${selected.email}`)}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <Mail size={14} />
                  Send follow-up email
                </button>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-[12px] text-slate-400">
              Select a referral to review and take the next action.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoPanel({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border-2 border-slate-200 bg-slate-50/35 p-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-[12px] text-slate-700">{value}</div>
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
