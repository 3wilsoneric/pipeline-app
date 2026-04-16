"use client";

import React, { useState } from "react";
import {
  User,
  Bell,
  Shield,
  Database,
  Mail,
  Phone,
  MapPin,
  Save,
  RefreshCw,
  Download,
  Upload,
} from "lucide-react";
import UserAvatar from "@/components/pipeline/UserAvatar";

interface SettingsProps {
  searchTerm: string;
}

type TabId = "profile" | "notifications" | "system" | "data";

export default function Settings({ searchTerm }: SettingsProps) {
  void searchTerm;

  const [activeTab, setActiveTab] = useState<TabId>("profile");
  const [saved, setSaved] = useState(false);

  const [profile, setProfile] = useState({
    firstName: "Sarah",
    lastName: "Johnson",
    email: "sjohnson@pipeline.org",
    phone: "(510) 555-0123",
    role: "Admissions Coordinator",
    county: "Contra Costa",
  });

  const [notifications, setNotifications] = useState({
    emailNewReferrals: true,
    emailAssessmentReminders: true,
    emailCapacityAlerts: true,
    smsUrgentReferrals: true,
    smsAssessmentReminders: false,
    pushNewMessages: true,
    pushCapacityChanges: true,
  });

  const [system, setSystem] = useState({
    autoAssignReferrals: true,
    assessmentReminderHours: 24,
    capacityThreshold: 90,
    workingHoursStart: "08:00",
    workingHoursEnd: "17:00",
    timezone: "America/Los_Angeles",
  });

  const tabs: Array<{ id: TabId; label: string; icon: React.ComponentType<{ size?: number }> }> = [
    { id: "profile", label: "Profile", icon: User },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "system", label: "System", icon: Shield },
    { id: "data", label: "Data", icon: Database },
  ];

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex shrink-0 items-center justify-between">
        <div className="text-[11px] text-slate-500">Workspace preferences</div>
        <button
          onClick={handleSave}
          className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-semibold transition-colors ${
            saved
              ? "app-gradient-button text-white"
              : "app-gradient-button text-white"
          }`}
        >
          {saved ? (
            <>
              <RefreshCw size={14} className="animate-spin" />
              Saved
            </>
          ) : (
            <>
              <Save size={14} />
              Save changes
            </>
          )}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 xl:flex-row">
        <div className="h-fit w-full rounded-2xl border border-slate-200 bg-white p-3 xl:w-56">
          <div className="mb-3 border-b border-slate-200 px-1 pb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Settings
          </div>
          <nav className="space-y-1.5">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-[12px] transition-colors ${
                    active
                      ? "border-slate-300 bg-slate-100 text-slate-900"
                      : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <Icon size={14} />
                  <span className={active ? "font-semibold" : "font-medium"}>
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white">
          {activeTab === "profile" && (
            <div className="space-y-3 p-4">
              <SectionHeader
                title="Profile"
                description="Identity, contact info, and local coverage."
              />

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-4">
                  <UserAvatar size="lg" />
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-slate-900">
                      {profile.firstName} {profile.lastName}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {profile.role}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field label="First name">
                  <input
                    value={profile.firstName}
                    onChange={(e) =>
                      setProfile({ ...profile, firstName: e.target.value })
                    }
                    className={inputClassName}
                  />
                </Field>
                <Field label="Last name">
                  <input
                    value={profile.lastName}
                    onChange={(e) =>
                      setProfile({ ...profile, lastName: e.target.value })
                    }
                    className={inputClassName}
                  />
                </Field>
                <Field label="Email">
                  <InputWithIcon icon={<Mail size={14} />} value={profile.email}>
                    <input
                      type="email"
                      value={profile.email}
                      onChange={(e) =>
                        setProfile({ ...profile, email: e.target.value })
                      }
                      className={inputWithIconClassName}
                    />
                  </InputWithIcon>
                </Field>
                <Field label="Phone">
                  <InputWithIcon icon={<Phone size={14} />} value={profile.phone}>
                    <input
                      value={profile.phone}
                      onChange={(e) =>
                        setProfile({ ...profile, phone: e.target.value })
                      }
                      className={inputWithIconClassName}
                    />
                  </InputWithIcon>
                </Field>
                <Field label="Role">
                  <select
                    value={profile.role}
                    onChange={(e) =>
                      setProfile({ ...profile, role: e.target.value })
                    }
                    className={inputClassName}
                  >
                    <option>Admissions Coordinator</option>
                    <option>Assessment Specialist</option>
                    <option>Program Integrity Officer</option>
                    <option>Administrator</option>
                  </select>
                </Field>
                <Field label="Primary county">
                  <InputWithIcon icon={<MapPin size={14} />} value={profile.county}>
                    <select
                      value={profile.county}
                      onChange={(e) =>
                        setProfile({ ...profile, county: e.target.value })
                      }
                      className={inputWithIconClassName}
                    >
                      <option>Contra Costa</option>
                      <option>Los Angeles</option>
                      <option>San Francisco</option>
                      <option>Stanislaus</option>
                      <option>Riverside</option>
                    </select>
                  </InputWithIcon>
                </Field>
              </div>
            </div>
          )}

          {activeTab === "notifications" && (
            <div className="space-y-3 p-4">
              <SectionHeader
                title="Notifications"
                description="Keep only the alerts that matter."
              />

              <div className="grid gap-3 lg:grid-cols-3">
                <PreferenceGroup
                  title="Email"
                  items={[
                    {
                      label: "New referrals",
                      checked: notifications.emailNewReferrals,
                      onChange: (checked) =>
                        setNotifications({
                          ...notifications,
                          emailNewReferrals: checked,
                        }),
                    },
                    {
                      label: "Assessment reminders",
                      checked: notifications.emailAssessmentReminders,
                      onChange: (checked) =>
                        setNotifications({
                          ...notifications,
                          emailAssessmentReminders: checked,
                        }),
                    },
                    {
                      label: "Capacity alerts",
                      checked: notifications.emailCapacityAlerts,
                      onChange: (checked) =>
                        setNotifications({
                          ...notifications,
                          emailCapacityAlerts: checked,
                        }),
                    },
                  ]}
                />
                <PreferenceGroup
                  title="SMS"
                  items={[
                    {
                      label: "Urgent referrals only",
                      checked: notifications.smsUrgentReferrals,
                      onChange: (checked) =>
                        setNotifications({
                          ...notifications,
                          smsUrgentReferrals: checked,
                        }),
                    },
                    {
                      label: "Assessment reminders",
                      checked: notifications.smsAssessmentReminders,
                      onChange: (checked) =>
                        setNotifications({
                          ...notifications,
                          smsAssessmentReminders: checked,
                        }),
                    },
                  ]}
                />
                <PreferenceGroup
                  title="Push"
                  items={[
                    {
                      label: "New messages",
                      checked: notifications.pushNewMessages,
                      onChange: (checked) =>
                        setNotifications({
                          ...notifications,
                          pushNewMessages: checked,
                        }),
                    },
                    {
                      label: "Capacity changes",
                      checked: notifications.pushCapacityChanges,
                      onChange: (checked) =>
                        setNotifications({
                          ...notifications,
                          pushCapacityChanges: checked,
                        }),
                    },
                  ]}
                />
              </div>
            </div>
          )}

          {activeTab === "system" && (
            <div className="space-y-3 p-4">
              <SectionHeader
                title="System"
                description="Operational defaults for assignments, reminders, and hours."
              />

              <div className="rounded-2xl border border-slate-200 bg-white">
                <label className="flex items-center justify-between gap-4 px-4 py-3">
                  <div>
                    <div className="text-[12px] font-semibold text-slate-900">
                      Auto-assign referrals
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      Automatically assign new intake based on workload.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={system.autoAssignReferrals}
                    onChange={(e) =>
                      setSystem({
                        ...system,
                        autoAssignReferrals: e.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded border-slate-300 text-slate-700 focus:ring-slate-300"
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Assessment reminder (hours)">
                  <input
                    type="number"
                    value={system.assessmentReminderHours}
                    onChange={(e) =>
                      setSystem({
                        ...system,
                        assessmentReminderHours: parseInt(e.target.value, 10),
                      })
                    }
                    className={inputClassName}
                  />
                </Field>
                <Field label="Capacity alert threshold (%)">
                  <input
                    type="number"
                    value={system.capacityThreshold}
                    onChange={(e) =>
                      setSystem({
                        ...system,
                        capacityThreshold: parseInt(e.target.value, 10),
                      })
                    }
                    className={inputClassName}
                  />
                </Field>
                <Field label="Working hours start">
                  <input
                    type="time"
                    value={system.workingHoursStart}
                    onChange={(e) =>
                      setSystem({ ...system, workingHoursStart: e.target.value })
                    }
                    className={inputClassName}
                  />
                </Field>
                <Field label="Working hours end">
                  <input
                    type="time"
                    value={system.workingHoursEnd}
                    onChange={(e) =>
                      setSystem({ ...system, workingHoursEnd: e.target.value })
                    }
                    className={inputClassName}
                  />
                </Field>
              </div>

              <Field label="Timezone">
                <select
                  value={system.timezone}
                  onChange={(e) =>
                    setSystem({ ...system, timezone: e.target.value })
                  }
                  className={inputClassName}
                >
                  <option>America/Los_Angeles</option>
                  <option>America/Denver</option>
                  <option>America/Chicago</option>
                  <option>America/New_York</option>
                </select>
              </Field>
            </div>
          )}

          {activeTab === "data" && (
            <div className="space-y-3 p-4">
              <SectionHeader
                title="Data"
                description="Export reporting sets and stage imports."
              />

              <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-3">
                  <ActionPanel
                    title="Export data"
                    description="Download referral, assessment, and community data."
                    actions={[
                      {
                        label: "Referrals CSV",
                        icon: <Download size={14} />,
                      },
                      {
                        label: "Assessments CSV",
                        icon: <Download size={14} />,
                      },
                    ]}
                  />

                  <ActionPanel
                    title="Import data"
                    description="Upload bulk referral or capacity data."
                    actions={[
                      {
                        label: "Upload file",
                        icon: <Upload size={14} />,
                      },
                    ]}
                  />
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Storage
                  </div>
                  <div className="mt-3 space-y-2 text-[12px] text-slate-600">
                    <StorageRow label="Referrals" value="1,247" />
                    <StorageRow label="Assessment packets" value="893" />
                    <StorageRow label="Retention policy" value="7 years" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {title}
      </div>
      <div className="mt-1 text-[11px] text-slate-500">{description}</div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </label>
      {children}
    </div>
  );
}

function InputWithIcon({
  icon,
  children,
}: {
  icon: React.ReactNode;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
        {icon}
      </div>
      {children}
    </div>
  );
}

function PreferenceGroup({
  title,
  items,
}: {
  title: string;
  items: Array<{
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
  }>;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {title}
      </div>
      <div className="divide-y divide-slate-200">
        {items.map((item) => (
          <label
            key={item.label}
            className="flex items-center justify-between gap-4 px-4 py-3"
          >
            <span className="text-[12px] text-slate-700">{item.label}</span>
            <input
              type="checkbox"
              checked={item.checked}
              onChange={(e) => item.onChange(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-slate-700 focus:ring-slate-300"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function ActionPanel({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions: Array<{ label: string; icon: React.ReactNode }>;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {title}
        </div>
        <div className="mt-1 text-[11px] text-slate-500">{description}</div>
      </div>
      <div className="flex flex-wrap gap-2 p-3">
        {actions.map((action) => (
          <button
            key={action.label}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            {action.icon}
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function StorageRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2">
      <span>{label}</span>
      <span className="font-semibold text-slate-900">{value}</span>
    </div>
  );
}

const inputClassName =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-800 outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-200";

const inputWithIconClassName =
  "w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-[12px] text-slate-800 outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-200";
