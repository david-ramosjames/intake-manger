"use client";

import { useState } from "react";
import {
  QUALIFIED_NO,
  QUALIFIED_YES,
  SIZE_TAGS,
  TAG_LABEL,
  declineOptions,
  declineReasonFromTag,
  qualifiedChoice,
  selectedDecline,
  selectedOne,
} from "@/lib/tags";

export function LeadTagFields({
  tags,
  declineReason,
  signed = false,
  desired = false,
  nonPi = false,
  callrail = false,
  quiet = false,
  qualifiedMark = "",
}: {
  tags: string[];
  declineReason?: string | null;
  signed?: boolean;
  desired?: boolean;
  nonPi?: boolean;
  callrail?: boolean;
  quiet?: boolean;
  qualifiedMark?: string;
}) {
  const qualifiedStart =
    qualifiedChoice(tags) ||
    (qualifiedMark === "Yes" ? QUALIFIED_YES : qualifiedMark === "No" ? QUALIFIED_NO : "");
  const [qualified, setQualified] = useState(qualifiedStart);
  const [decline, setDecline] = useState(signed ? "" : selectedDecline(tags));
  const [size, setSize] = useState(selectedOne(tags, SIZE_TAGS));
  const reason = declineReasonFromTag(decline) ?? (decline ? declineReason : null);
  const showReasons = qualified === QUALIFIED_NO;
  const showSize = !quiet && (desired || signed);

  return (
    <fieldset className={quiet ? "space-y-5 text-sm" : "space-y-3 text-sm"}>
      {nonPi ? <input type="hidden" name="non_pi" value="yes" /> : null}
      {quiet ? (
        qualified ? <input type="hidden" name="qualified_tag" value={qualified} /> : null
      ) : (
        <>
          <legend className="font-medium text-slate-700">Qualified</legend>
          <p className="text-slate-500">
            Every lead is Qualified YES or Qualified NO. A declined lead, and a lead that finishes follow-up with no contact, are Qualified NO.
          </p>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="qualified_tag"
                value={QUALIFIED_YES}
                checked={qualified === QUALIFIED_YES}
                onChange={() => setQualified(QUALIFIED_YES)}
              />
              {TAG_LABEL[QUALIFIED_YES]}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="qualified_tag"
                value={QUALIFIED_NO}
                checked={qualified === QUALIFIED_NO}
                onChange={() => setQualified(QUALIFIED_NO)}
              />
              {TAG_LABEL[QUALIFIED_NO]}
            </label>
          </div>
        </>
      )}
      {showReasons ? (
        <label className="block">
          <span className={quiet ? "text-xs font-semibold uppercase tracking-wide text-slate-500" : "font-medium text-slate-700"}>Declined</span>
          <select
            name="decline_tag"
            value={decline}
            disabled={signed}
            onChange={(event) => setDecline(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
          >
            <option value="">No decline</option>
            {declineOptions(decline).map((tag) => (
              <option key={tag} value={tag}>
                {tag.slice("DEC: ".length)}
              </option>
            ))}
          </select>
          {quiet ? null : (
            <p className="mt-2 text-slate-600">
              Decline reason: {reason || "Only filled when a DEC tag is used. DEC means declined."}
            </p>
          )}
        </label>
      ) : null}
      {showSize ? (
        <label className="block">
          <span className={quiet ? "text-xs font-semibold uppercase tracking-wide text-slate-500" : "font-medium text-slate-700"}>Size</span>
          <select
            name="size_tag"
            value={size}
            onChange={(event) => setSize(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
          >
            <option value="">No size</option>
            {SIZE_TAGS.map((tag) => (
              <option key={tag} value={tag}>
                {TAG_LABEL[tag]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {quiet ? null : (
        <p className="text-slate-500">
          {callrail
            ? "Saving writes these tags onto the CallRail call and leaves its other tags in place."
            : "This lead has no CallRail call stored, so the tags stay in Intake Manager."}
        </p>
      )}
    </fieldset>
  );
}
