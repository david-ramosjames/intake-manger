"use client";

import { useState } from "react";

export function QueueHelp() {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-600 hover:border-slate-400"
      >
        Help
      </button>
      {open ? (
        <>
          <button type="button" aria-label="Close help" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-2 w-80 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700 shadow-lg">
            <p className="font-medium text-navy">Non-leads</p>
            <p className="mt-1">
              Spam, vendors, employment, existing clients, insurance, other law offices, wrong numbers, and return calls. A legal question outside personal injury stays open until someone confirms the decline.
            </p>
            <p className="mt-3 font-medium text-navy">When a lead closes</p>
            <p className="mt-1">
              A lead stays open until it is signed, declined, referred, or rejected. It also closes when the call sequence finishes with no reply, or when the contract reminder series finishes with no signature. Counts on this page are the last 30 days. Conversion is signed leads among desired cases.
            </p>
          </div>
        </>
      ) : null}
    </span>
  );
}
