"use client";

import { useMemo, useState } from "react";
import { markReferralOpportunity, sendReferral } from "@/lib/ops-actions";
import {
  PRACTICE_AREAS,
  isGuideReferral,
  renderPropertyDamageSms,
  renderReferralSms,
  type ReferralDestination,
} from "@/lib/referrals";

export function ReferralPanel({
  leadId,
  leadName,
  practiceArea,
  referralOpportunity,
  destinations,
  templates,
  propertyDamageGuides = { en: "", es: "" },
  closed,
}: {
  leadId: string;
  leadName: string | null;
  practiceArea: string | null;
  referralOpportunity: boolean;
  destinations: ReferralDestination[];
  templates: { en: string; es: string };
  propertyDamageGuides?: { en: string; es: string };
  closed: boolean;
}) {
  const [area, setArea] = useState(practiceArea ?? "");
  const [destinationId, setDestinationId] = useState("");
  const [language, setLanguage] = useState<"en" | "es">("en");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const guide = isGuideReferral(area);
  const matches = useMemo(
    () => destinations.filter((destination) => destination.practice_areas.includes(area)).sort((a, b) => a.name.localeCompare(b.name)),
    [destinations, area],
  );
  const destination = matches.find((item) => item.id === destinationId) ?? matches[0] ?? null;
  const preview = !area
    ? ""
    : guide
      ? renderPropertyDamageSms({ language, leadName, guides: propertyDamageGuides })
      : destination
        ? renderReferralSms({
            language,
            template: templates[language],
            leadName,
            area,
            destination,
          })
        : "";

  if (closed) {
    return <p className="mt-1 text-sm text-slate-600">This referral is already recorded and the lead is closed.</p>;
  }

  return (
    <div className="mt-3 grid gap-4">
      <form action={markReferralOpportunity.bind(null, leadId)} className="grid gap-3">
        <label className="text-sm">
          <span className="font-medium text-slate-700">Practice area</span>
          <select
            name="practice_area"
            value={area}
            onChange={(event) => {
              setArea(event.target.value);
              setDestinationId("");
            }}
            required
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="">Choose the legal area</option>
            {[...PRACTICE_AREAS].sort((a, b) => a.label.localeCompare(b.label)).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="w-fit rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm">
          {referralOpportunity ? "Update the referral tag" : "Tag as referral opportunity"}
        </button>
      </form>

      <form
        className="grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          setError(null);
          const data = new FormData(event.currentTarget);
          const result = await sendReferral(leadId, data);
          setPending(false);
          if (result.error) setError(result.error);
        }}
      >
        <input type="hidden" name="practice_area" value={area} />
        {!guide ? (
          <label className="text-sm">
            <span className="font-medium text-slate-700">Attorney</span>
            <select
              name="destination_id"
              value={destination?.id ?? ""}
              onChange={(event) => setDestinationId(event.target.value)}
              required
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">{area ? "Choose who receives the referral" : "Choose a practice area first"}</option>
              {matches.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.phone ? ` · ${item.phone}` : ""}
                  {item.spanish ? " · Spanish" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-sm text-slate-600">
            Property Damage texts the saved guide PDF link instead of an attorney.
            {!propertyDamageGuides.en.trim() || !propertyDamageGuides.es.trim()
              ? " Set both links on the Referrals page first."
              : ""}
          </p>
        )}
        <label className="text-sm">
          <span className="font-medium text-slate-700">Text language</span>
          <select
            name="language"
            value={language}
            onChange={(event) => setLanguage(event.target.value === "es" ? "es" : "en")}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="en">English</option>
            <option value="es">Spanish</option>
          </select>
        </label>
        {!guide && destination?.notes ? <p className="text-sm text-slate-600">{destination.notes}</p> : null}
        {preview ? (
          <p className="whitespace-pre-line rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-800">{preview}</p>
        ) : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button type="submit" disabled={pending} className="w-fit rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-navy disabled:opacity-60">
          {pending ? "Sending…" : "Send text and close"}
        </button>
      </form>
    </div>
  );
}
