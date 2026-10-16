"use client";

import { useActionState } from "react";
import { addStaffContact, saveStaffContact } from "@/lib/ops-actions";
import type { StaffContact } from "@/lib/staff";

export function StaffForm({ person }: { person: StaffContact }) {
  const [state, action, pending] = useActionState(saveStaffContact, null);
  return (
    <form action={action} className={`grid gap-3 rounded-lg border px-4 py-3 ${person.listed ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50"}`}>
      <input type="hidden" name="id" value={person.id} />
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Name</span>
          <input name="name" required defaultValue={person.name} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Slack ID</span>
          <input name="slack_user_id" defaultValue={person.slackUserId ?? ""} placeholder="U05JBLVM3TM" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
        </label>
        <button type="submit" disabled={pending} className="cursor-pointer rounded-md bg-navy px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#16366e] disabled:opacity-60">
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
        <span>{person.email}</span>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="listed" value="yes" defaultChecked={person.listed} />
          At the firm
        </label>
      </div>
      {state?.error ? <p className="text-sm font-medium text-red-700">{state.error}</p> : null}
    </form>
  );
}

export function AddStaffForm({ missing }: { missing: string[] }) {
  const [state, action, pending] = useActionState(addStaffContact, null);
  return (
    <form action={action} className="mt-8 grid gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-navy">Add someone</h2>
      <p className="text-sm text-slate-600">They need a Ramos James login before they can be added.</p>
      {missing.length ? (
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Login</span>
          <select name="email" required className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" defaultValue="">
            <option value="">Choose an email</option>
            {missing.map((email) => (
              <option key={email} value={email}>
                {email}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input name="email" required placeholder="name@ramosjames.com" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
      )}
      <input name="name" required placeholder="Name, such as Jissela Calix" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
      <input name="slack_user_id" placeholder="Slack ID, such as U05JBLVM3TM" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
      <button type="submit" disabled={pending} className="w-fit cursor-pointer rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#16366e] disabled:opacity-60">
        {pending ? "Adding…" : "Add to the list"}
      </button>
      {state?.error ? <p className="text-sm font-medium text-red-700">{state.error}</p> : null}
    </form>
  );
}
