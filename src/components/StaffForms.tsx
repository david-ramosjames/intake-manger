"use client";

import { useActionState } from "react";
import { addStaffContact, saveStaffContact } from "@/lib/ops-actions";
import type { StaffContact } from "@/lib/staff";

export function StaffRow({ person }: { person: StaffContact }) {
  const [state, action, pending] = useActionState(saveStaffContact, null);
  return (
    <form action={action} className={`grid gap-2 border-b border-slate-200 px-3 py-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_auto] sm:items-center ${person.listed ? "bg-white" : "bg-slate-50"}`}>
      <input type="hidden" name="id" value={person.id} />
      <label className="min-w-0 text-sm">
        <span className="sr-only">Name</span>
        <input name="name" required defaultValue={person.name} className="w-full rounded-md border border-slate-300 px-2 py-1" />
        <span className="mt-0.5 block truncate text-xs text-slate-500">{person.email}</span>
      </label>
      <label className="min-w-0 text-sm">
        <span className="sr-only">Slack ID</span>
        <input name="slack_user_id" defaultValue={person.slackUserId ?? ""} placeholder="Slack ID" className="w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-xs" />
      </label>
      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" name="listed" value="yes" defaultChecked={person.listed} />
        At the firm
      </label>
      <button type="submit" disabled={pending} className="cursor-pointer rounded-md bg-navy px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-[#16366e] disabled:opacity-60">
        {pending ? "Saving…" : "Save"}
      </button>
      {state?.error ? <p className="text-sm font-medium text-red-700 sm:col-span-4">{state.error}</p> : null}
    </form>
  );
}

export function AddStaffForm({ missing }: { missing: string[] }) {
  const [state, action, pending] = useActionState(addStaffContact, null);
  return (
    <form action={action} className="mt-6 grid gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2">
      <h2 className="text-sm font-semibold text-navy sm:col-span-2">Add someone</h2>
      {missing.length ? (
        <select name="email" required className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" defaultValue="">
          <option value="">Choose an email</option>
          {missing.map((email) => (
            <option key={email} value={email}>
              {email}
            </option>
          ))}
        </select>
      ) : (
        <input name="email" required placeholder="name@ramosjames.com" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
      )}
      <input name="name" required placeholder="Name" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
      <input name="slack_user_id" placeholder="Slack ID" className="rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs" />
      <button type="submit" disabled={pending} className="w-fit cursor-pointer rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#16366e] disabled:opacity-60">
        {pending ? "Adding…" : "Add"}
      </button>
      {state?.error ? <p className="text-sm font-medium text-red-700 sm:col-span-2">{state.error}</p> : null}
    </form>
  );
}
