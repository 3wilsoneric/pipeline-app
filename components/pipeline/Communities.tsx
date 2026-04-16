"use client";

import React, { useState } from "react";
import {
    Users,
    TrendingUp,
    AlertCircle,
    Phone,
    Mail,
    ChevronRight,
    Activity,
} from "lucide-react";

/* =========================
   Types
========================= */

type StatusKey = "critical" | "high-demand" | "moderate" | "available";

interface Community {
    id: number;
    name: string;
    county: string;
    totalBeds: number;
    occupiedBeds: number;
    availableBeds: number;
    pendingAdmissions: number;
    assessmentsThisWeek: number;
    averageStay: number;
    activeReferrals: number;
    contactName: string;
    contactPhone: string;
    contactEmail: string;
    address: string;
    status: StatusKey;
    trend: "up" | "down" | "stable";
}

interface CommunitiesProps {
    searchTerm?: string;
}

/* =========================
   Mock Data
========================= */

const mockCommunities: Community[] = [
    {
        id: 1,
        name: "San Pablo",
        county: "Contra Costa",
        totalBeds: 48,
        occupiedBeds: 42,
        availableBeds: 6,
        pendingAdmissions: 3,
        assessmentsThisWeek: 8,
        averageStay: 14,
        activeReferrals: 12,
        contactName: "Maria Rodriguez",
        contactPhone: "(510) 555-0123",
        contactEmail: "mrodriguez@sanpablo.org",
        address: "123 Health Center Dr, San Pablo, CA 94806",
        status: "high-demand",
        trend: "up",
    },
    {
        id: 2,
        name: "Santa Clarita",
        county: "Los Angeles",
        totalBeds: 36,
        occupiedBeds: 28,
        availableBeds: 8,
        pendingAdmissions: 2,
        assessmentsThisWeek: 5,
        averageStay: 12,
        activeReferrals: 7,
        contactName: "David Chen",
        contactPhone: "(661) 555-0456",
        contactEmail: "dchen@santaclarita.org",
        address: "456 Valley Blvd, Santa Clarita, CA 91355",
        status: "moderate",
        trend: "stable",
    },
    {
        id: 3,
        name: "San Francisco",
        county: "San Francisco",
        totalBeds: 72,
        occupiedBeds: 69,
        availableBeds: 3,
        pendingAdmissions: 8,
        assessmentsThisWeek: 15,
        averageStay: 16,
        activeReferrals: 23,
        contactName: "Jennifer Wong",
        contactPhone: "(415) 555-0789",
        contactEmail: "jwong@sfhealth.org",
        address: "789 Mission St, San Francisco, CA 94103",
        status: "critical",
        trend: "up",
    },
    {
        id: 4,
        name: "Turlock",
        county: "Stanislaus",
        totalBeds: 24,
        occupiedBeds: 18,
        availableBeds: 6,
        pendingAdmissions: 1,
        assessmentsThisWeek: 3,
        averageStay: 11,
        activeReferrals: 4,
        contactName: "Robert Martinez",
        contactPhone: "(209) 555-0321",
        contactEmail: "rmartinez@turlock.org",
        address: "321 Center Ave, Turlock, CA 95380",
        status: "available",
        trend: "down",
    },
    {
        id: 5,
        name: "Riverside",
        county: "Riverside",
        totalBeds: 54,
        occupiedBeds: 48,
        availableBeds: 6,
        pendingAdmissions: 4,
        assessmentsThisWeek: 9,
        averageStay: 13,
        activeReferrals: 11,
        contactName: "Patricia Lee",
        contactPhone: "(951) 555-0654",
        contactEmail: "plee@riverside.org",
        address: "654 University Ave, Riverside, CA 92501",
        status: "high-demand",
        trend: "up",
    },
];

/* =========================
   Status Config
========================= */

const statusConfig: Record<
    StatusKey,
    { label: string; color: string; textColor: string }
> = {
    critical: {
        label: "Critical",
        color: "bg-red-100 text-red-700 border-red-300",
        textColor: "text-red-700",
    },
    "high-demand": {
        label: "High Demand",
        color: "bg-orange-100 text-orange-700 border-orange-300",
        textColor: "text-orange-700",
    },
    moderate: {
        label: "Moderate",
        color: "bg-amber-100 text-amber-700 border-amber-300",
        textColor: "text-amber-700",
    },
    available: {
        label: "Available",
        color: "bg-green-100 text-green-700 border-green-300",
        textColor: "text-green-700",
    },
};

/* =========================
   Component
========================= */

export default function Communities({ searchTerm = "" }: CommunitiesProps) {
    const [communities] = useState<Community[]>(mockCommunities);
    const [selectedCommunity, setSelectedCommunity] =
        useState<Community | null>(null);
    const [viewMode, setViewMode] = useState<"grid" | "table">("grid");

    const term = searchTerm.toLowerCase();

    const filteredCommunities = communities.filter(
        (c) =>
            c.name.toLowerCase().includes(term) ||
            c.county.toLowerCase().includes(term)
    );

    const totalStats = {
        totalBeds: communities.reduce((s, c) => s + c.totalBeds, 0),
        occupiedBeds: communities.reduce((s, c) => s + c.occupiedBeds, 0),
        availableBeds: communities.reduce((s, c) => s + c.availableBeds, 0),
        pendingAdmissions: communities.reduce(
            (s, c) => s + c.pendingAdmissions,
            0
        ),
    };

    const occupancyRate = (
        (totalStats.occupiedBeds / totalStats.totalBeds) *
        100
    ).toFixed(1);

    return (
        <div className="flex h-full min-h-0 flex-col gap-3 p-4">
            <div className="flex shrink-0 items-center justify-between">
                <div className="text-[11px] text-gray-500">
                    {filteredCommunities.length} facilities
                </div>

                <div className="flex overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <button
                        onClick={() => setViewMode("grid")}
                        className={`px-3 py-2 text-xs font-medium ${viewMode === "grid"
                            ? "bg-slate-900 text-white"
                            : "text-gray-700 hover:bg-gray-50"
                            }`}
                    >
                        Grid
                    </button>
                    <button
                        onClick={() => setViewMode("table")}
                        className={`px-3 py-2 text-xs font-medium ${viewMode === "table"
                            ? "bg-slate-900 text-white"
                            : "text-gray-700 hover:bg-gray-50"
                            }`}
                    >
                        Table
                    </button>
                </div>
            </div>

            {/* STATS */}
            <div className="grid shrink-0 gap-3 md:grid-cols-2 xl:grid-cols-5">
                <Stat label="Total Beds" value={totalStats.totalBeds} icon={Users} />
                <Stat
                    label="Available"
                    value={totalStats.availableBeds}
                    icon={Activity}
                />
                <Stat
                    label="Occupied"
                    value={totalStats.occupiedBeds}
                    icon={Users}
                />
                <Stat
                    label="Occupancy Rate"
                    value={`${occupancyRate}%`}
                    icon={TrendingUp}
                />
                <Stat
                    label="Pending"
                    value={totalStats.pendingAdmissions}
                    icon={AlertCircle}
                />
            </div>

            {/* GRID */}
            {viewMode === "grid" && (
                <div className="grid grid-cols-2 gap-6">
                    {filteredCommunities.map((c) => {
                        const occupancy = Math.round(
                            (c.occupiedBeds / c.totalBeds) * 100
                        );

                        return (
                            <div
                                key={c.id}
                                onClick={() => setSelectedCommunity(c)}
                                className="cursor-pointer rounded-xl border border-slate-200 bg-white transition-colors hover:bg-slate-50"
                            >
                                <div className="p-6">
                                    <div className="flex justify-between mb-4">
                                        <div>
                                            <h3 className="text-lg font-medium">{c.name}</h3>
                                            <p className="text-sm text-gray-600">
                                                {c.county} County
                                            </p>
                                        </div>
                                        <span
                                            className={`rounded-full border px-3 py-1 text-xs font-medium ${statusConfig[c.status].color}`}
                                        >
                                            {statusConfig[c.status].label}
                                        </span>
                                    </div>

                                    <div className="mb-4">
                                        <div className="flex justify-between text-sm font-medium">
                                            <span>Bed Capacity</span>
                                            <span>{occupancy}%</span>
                                        </div>
                                        <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-slate-700"
                                                style={{ width: `${occupancy}%` }}
                                            />
                                        </div>
                                    </div>

                                    <div className="flex justify-between text-sm">
                                        <span>{c.occupiedBeds} occupied</span>
                                        <span>{c.availableBeds} available</span>
                                    </div>

                                    <div className="pt-4 mt-4 border-t flex justify-between items-center">
                                        <div>
                                            <p className="text-xs font-medium">{c.contactName}</p>
                                            <p className="text-xs text-gray-600">
                                                {c.contactPhone}
                                            </p>
                                        </div>
                                        <ChevronRight className="text-gray-400" />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* TABLE */}
            {viewMode === "table" && (
                <div className="overflow-auto rounded-2xl border border-slate-200 bg-white">
                    <table className="w-full">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium">
                                    Community
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium">
                                    Status
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium">
                                    Beds
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium">
                                    Available
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium">
                                    Pending
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium">
                                    Contact
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredCommunities.map((c) => (
                                <tr key={c.id} className="border-t hover:bg-gray-50">
                                    <td className="px-6 py-4 font-medium">{c.name}</td>
                                    <td className="px-6 py-4">
                                        <span
                                            className={`rounded-full border px-2 py-1 text-xs font-medium ${statusConfig[c.status].color}`}
                                        >
                                            {statusConfig[c.status].label}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        {c.occupiedBeds}/{c.totalBeds}
                                    </td>
                                    <td className="px-6 py-4">{c.availableBeds}</td>
                                    <td className="px-6 py-4">{c.pendingAdmissions}</td>
                                    <td className="px-6 py-4">
                                        <div className="text-sm">{c.contactName}</div>
                                        <div className="text-xs text-gray-500">
                                            {c.contactPhone}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* MODAL */}
            {selectedCommunity && (
                <div
                    className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
                    onClick={() => setSelectedCommunity(null)}
                >
                    <div
                    className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h2 className="text-xl font-bold mb-2">
                            {selectedCommunity.name}
                        </h2>
                        <p className="text-sm text-gray-600 mb-4">
                            {selectedCommunity.address}
                        </p>

                        <div className="space-y-2 text-sm">
                            <div>
                                <strong>Contact:</strong> {selectedCommunity.contactName}
                            </div>
                            <div>
                                <Phone className="inline mr-2" size={14} />
                                {selectedCommunity.contactPhone}
                            </div>
                            <div>
                                <Mail className="inline mr-2" size={14} />
                                {selectedCommunity.contactEmail}
                            </div>
                        </div>

                        <div className="mt-6 text-right">
                            <button
                                onClick={() => setSelectedCommunity(null)}
                                className="px-4 py-2 bg-gray-200 rounded"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/* =========================
   Small Stat Tile
========================= */

function Stat({
    label,
    value,
    icon: Icon,
}: {
    label: string;
    value: number | string;
    icon: React.ElementType;
}) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex justify-between items-center mb-1">
                <p className="text-xs font-bold uppercase">{label}</p>
                <Icon size={18} />
            </div>
            <p className="text-2xl font-bold">{value}</p>
        </div>
    );
}
