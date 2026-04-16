"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUp,
  Bot,
  ChevronLeft,
  MessageSquareMore,
  Sparkles,
} from "lucide-react";

type ChatMessage = {
  id: number;
  role: "assistant" | "user";
  content: string;
};

const starterMessages: ChatMessage[] = [
  {
    id: 1,
    role: "assistant",
    content:
      "Headless Pipeline is ready. Ask for queue status, packet blockers, routing context, or what should happen next.",
  },
];

const suggestedPrompts = [
  "What needs attention today?",
  "Show packet blockers",
  "Who is unassigned in intake?",
  "What can be routed next?",
];

export default function PipelineChat() {
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [input, setInput] = useState("");
  const nextMessageId = useRef(starterMessages.length + 1);

  const conversationCount = useMemo(
    () => messages.filter((message) => message.role === "user").length,
    [messages],
  );

  const sendMessage = (content: string) => {
    const trimmed = content.trim();

    if (!trimmed) return;

    const userMessage: ChatMessage = {
      id: nextMessageId.current,
      role: "user",
      content: trimmed,
    };

    const assistantMessage: ChatMessage = {
      id: nextMessageId.current + 1,
      role: "assistant",
      content: buildAssistantReply(trimmed),
    };

    setMessages((current) => [...current, userMessage, assistantMessage]);
    nextMessageId.current += 2;
    setInput("");
  };

  return (
    <div className="flex min-h-screen bg-transparent text-slate-900">
      <aside className="hidden w-[256px] shrink-0 border-r border-slate-200 bg-[#fcfdfd] lg:flex lg:flex-col">
        <div className="border-b border-slate-200 px-4 py-4">
          <Link href="/" className="inline-flex items-center gap-3">
            <span className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[1.08rem] font-bold tracking-[-0.04em] text-slate-950">
              Pipeline
            </span>
          </Link>
        </div>

        <div className="border-b border-slate-200 px-4 py-4">
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50/35 p-4">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
              <MessageSquareMore size={14} className="text-indigo-600" />
              Headless Mode
            </div>
            <div className="mt-2 text-[13px] font-medium text-slate-900">
              Work with Pipeline by conversation instead of moving through the UI.
            </div>
          </div>
        </div>

        <div className="space-y-3 px-4 py-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
              Session
            </div>
            <div className="mt-2 text-[12px] text-slate-600">
              {conversationCount} prompts sent
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
              Can Help With
            </div>
            <div className="mt-2 space-y-2 text-[12px] text-slate-600">
              <div>Queue triage</div>
              <div>Packet review summaries</div>
              <div>Routing readiness</div>
              <div>Next-step guidance</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <main className="flex flex-1 min-h-0 flex-col">
          <div className="mx-auto flex h-full w-full max-w-5xl min-h-0 flex-col px-4 pb-4 pt-4">
            <div className="mb-4 flex items-center justify-end">
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                <ChevronLeft size={14} />
                Back to app
              </Link>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              {suggestedPrompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  className="rounded-full border border-indigo-200 bg-indigo-50/35 px-3 py-2 text-[12px] font-medium text-slate-700 transition-colors hover:bg-indigo-50/60"
                >
                  {prompt}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-auto rounded-[24px] border-2 border-slate-200 bg-white px-5 py-5">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${
                      message.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-3xl border px-4 py-3 ${
                        message.role === "user"
                          ? "border-indigo-200 bg-indigo-50/45"
                          : "border-slate-200 bg-slate-50/40"
                      }`}
                    >
                      <div className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
                        {message.role === "assistant" ? (
                          <Bot size={13} className="text-indigo-600" />
                        ) : (
                          <Sparkles size={13} className="text-slate-500" />
                        )}
                        {message.role === "assistant" ? "Pipeline" : "You"}
                      </div>
                      <div className="text-[14px] leading-7 text-slate-700">
                        {message.content}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 rounded-[24px] border-2 border-slate-200 bg-white p-3">
              <div className="mx-auto flex w-full max-w-3xl items-end gap-3">
                <div className="min-w-0 flex-1">
                  <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        sendMessage(input);
                      }
                    }}
                    rows={3}
                    placeholder="Ask Pipeline what needs attention, what is blocked, or what to do next..."
                    className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-[14px] text-slate-700 outline-none transition-all placeholder:text-slate-400 focus:border-indigo-200 focus:bg-white focus:ring-2 focus:ring-indigo-50"
                  />
                </div>
                <button
                  onClick={() => sendMessage(input)}
                  className="app-gradient-button inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-all"
                  aria-label="Send message"
                >
                  <ArrowUp size={18} />
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function buildAssistantReply(input: string) {
  const value = input.toLowerCase();

  if (value.includes("attention") || value.includes("today")) {
    return "Top priorities: unassigned intake referrals, packets still missing required fields, and scheduled referrals awaiting routing confirmation.";
  }

  if (value.includes("packet")) {
    return "Packet review should focus on missing extracted fields, incomplete uploads, and referrals still waiting on clinical notes or medication lists.";
  }

  if (value.includes("unassigned") || value.includes("owner")) {
    return "The highest-value next step is assigning intake records without an owner before outreach or packet requests stall.";
  }

  if (value.includes("route") || value.includes("community")) {
    return "Routing should prioritize referrals with completed packets, clinician notes, and a clear community fit based on current readiness.";
  }

  if (value.includes("next")) {
    return "Recommended sequence: triage urgent intake, complete packet gaps, finalize review notes, then move ready referrals into routing.";
  }

  return "I can help summarize intake queues, packet blockers, readiness for routing, and next-step workflow actions inside Pipeline.";
}
