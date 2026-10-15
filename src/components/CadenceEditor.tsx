"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { saveCadence } from "@/lib/ops-actions";
import {
  NEW_LEAD_CADENCE,
  type CadenceDay,
  type CallbackWindow,
  type CallSequenceId,
} from "@/lib/sequences";

const WINDOWS: { id: CallbackWindow; label: string }[] = [
  { id: "morning", label: "Morning (8:30–11:30)" },
  { id: "lunch", label: "Lunch (11:30–2:30)" },
  { id: "afternoon", label: "Afternoon (2:30–5:30)" },
  { id: "contact", label: "Match last contact" },
];

function resize(list: CallbackWindow[], count: number, first: CallbackWindow, extra: CallbackWindow): CallbackWindow[] {
  const next = list.slice(0, count);
  while (next.length < count) next.push(next.length === 0 ? first : extra);
  return next;
}

export function CadenceEditor({
  sequence,
  initial,
  saved,
}: {
  sequence: CallSequenceId;
  initial: CadenceDay[];
  saved: boolean;
}) {
  const [days, setDays] = useState<CadenceDay[]>(initial);
  const [changed, setChanged] = useState(false);
  const calls = days.reduce((sum, day) => sum + day.calls.length, 0);
  const texts = days.reduce((sum, day) => sum + day.texts.length, 0);

  function update(index: number, count: number) {
    setChanged(true);
    setDays((current) =>
      current.map((day, dayIndex) => {
        if (dayIndex !== index) return day;
        const extra = day.calls[0] === "afternoon" ? "morning" : "afternoon";
        return { ...day, calls: resize(day.calls, count, "morning", extra) };
      }),
    );
  }

  function updateTexts(index: number, count: number) {
    setChanged(true);
    setDays((current) =>
      current.map((day, dayIndex) =>
        dayIndex === index ? { ...day, texts: resize(day.texts, count, "afternoon", "afternoon") } : day,
      ),
    );
  }

  function setWindow(index: number, slot: number, value: CallbackWindow) {
    setChanged(true);
    setDays((current) =>
      current.map((day, dayIndex) => {
        if (dayIndex !== index) return day;
        const list = [...day.calls];
        list[slot] = value;
        return { ...day, calls: list };
      }),
    );
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-xl font-semibold text-navy">Follow-up cadence</h2>
            <p className="mt-1 text-sm text-slate-500">
              Calls land inside the window you pick, at a different minute for each lead.
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                <th className="px-4 py-3">Day</th>
                <th className="px-3 py-3">Calls</th>
                <th className="px-3 py-3">Call time</th>
                <th className="px-3 py-3">Texts</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day, index) => (
                <tr key={index} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-800">Day {index + 1}</td>
                  <td className="px-3 py-3">
                    <Count kind="call" value={day.calls.length} onChange={(count) => update(index, count)} />
                  </td>
                  <td className="px-3 py-3">
                    <Windows values={day.calls} onChange={(slot, value) => setWindow(index, slot, value)} />
                  </td>
                  <td className="px-3 py-3">
                    <Count kind="text" value={day.texts.length} onChange={(count) => updateTexts(index, count)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form action={saveCadence} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
          <input type="hidden" name="sequence" value={sequence} />
          <input type="hidden" name="days" value={JSON.stringify(days)} />
          <p className="text-sm text-slate-500">Set how many texts go out each day. SMS Follow-Up chooses the time.</p>
          <div className="flex items-center gap-3">
            {saved && !changed ? <p className="text-sm font-medium text-emerald-700">Saved.</p> : null}
            <button
              type="button"
              onClick={() => {
                setChanged(true);
                setDays(NEW_LEAD_CADENCE.map((day) => ({ calls: [...day.calls], texts: [...day.texts] })));
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
            >
              Reset to default
            </button>
            <SaveButton />
          </div>
        </form>
      </section>

      <aside className="space-y-3">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-navy">Callback time options</h3>
          <p className="mt-1 text-xs text-slate-500">Each attempt uses one of these windows.</p>
          <ul className="mt-3 space-y-2 text-sm">
            <WindowCard tone="bg-emerald-50 text-emerald-900" title="Morning" detail="8:30 AM – 11:30 AM" />
            <WindowCard tone="bg-amber-50 text-amber-950" title="Lunch" detail="11:30 AM – 2:30 PM" />
            <WindowCard tone="bg-sky-50 text-sky-950" title="Afternoon" detail="2:30 PM – 5:30 PM" />
            <WindowCard tone="bg-violet-50 text-violet-950" title="Match last contact" detail="The same window as the last call or text." />
          </ul>
        </section>
        <section className="rounded-xl border border-sky-100 bg-sky-50 p-4 text-sm text-sky-950">
          <h3 className="font-semibold">Recommended timing</h3>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5">
            <li>If a day has two calls, they stay at least 2 hours apart.</li>
            <li>Morning and afternoon are the strongest windows.</li>
            <li>Nothing is placed before 8:30 AM or after 5:30 PM.</li>
            <li>Match last contact uses that whole window, then picks a minute inside it.</li>
          </ul>
        </section>
        <section className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-950">
          <h3 className="font-semibold">Cadence summary</h3>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between"><dt>Total calls</dt><dd className="font-semibold">{calls}</dd></div>
            <div className="flex justify-between"><dt>Total texts</dt><dd className="font-semibold">{texts}</dd></div>
            <div className="flex justify-between"><dt>Duration</dt><dd className="font-semibold">{days.length} days</dd></div>
          </dl>
        </section>
      </aside>
    </div>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-navy disabled:opacity-60">
      {pending ? "Saving…" : "Save cadence"}
    </button>
  );
}

function Count({
  kind,
  value,
  onChange,
}: {
  kind: "call" | "text";
  value: number;
  onChange: (count: number) => void;
}) {
  const text = kind === "text";
  return (
    <label className="inline-flex items-center gap-2">
      <span
        className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${
          text ? "bg-sky-100 text-sky-700" : "bg-emerald-100 text-emerald-700"
        }`}
      >
        {text ? <TextIcon /> : <PhoneIcon />}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="rounded-md border border-slate-200 bg-white px-2 py-1.5"
        aria-label={text ? "Number of texts" : "Number of calls"}
      >
        {(text ? [0, 1, 2] : [0, 1, 2, 3]).map((count) => (
          <option key={count} value={count}>
            {count}
          </option>
        ))}
      </select>
    </label>
  );
}

function Windows({
  values,
  onChange,
}: {
  values: CallbackWindow[];
  onChange: (index: number, value: CallbackWindow) => void;
}) {
  if (!values.length) return <span className="text-slate-300">—</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {values.map((value, index) => (
        <span key={index} className="inline-flex items-center gap-1">
          {index > 0 ? <span className="text-slate-400">+</span> : null}
          <select
            value={value}
            onChange={(event) => onChange(index, event.target.value as CallbackWindow)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1.5"
            aria-label={`Window ${index + 1}`}
          >
            {WINDOWS.map((window) => (
              <option key={window.id} value={window.id}>
                {window.label}
              </option>
            ))}
          </select>
        </span>
      ))}
    </span>
  );
}

function WindowCard({ tone, title, detail }: { tone: string; title: string; detail: string }) {
  return (
    <li className={`rounded-lg px-3 py-2 ${tone}`}>
      <p className="font-medium">{title}</p>
      <p className="text-xs">{detail}</p>
    </li>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 4h4l2 4-2 1a12 12 0 0 0 5 5l1-2 4 2v4a2 2 0 0 1-2 2A16 16 0 0 1 4 6a2 2 0 0 1 2-2z" />
    </svg>
  );
}

function TextIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M5 6h14v9H8l-3 3z" />
    </svg>
  );
}
