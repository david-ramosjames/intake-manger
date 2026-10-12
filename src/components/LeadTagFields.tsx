"use client";

import { useState } from "react";
import {
  COVERAGE_TAGS,
  DECLINE_TAGS,
  QUALIFIED_NO,
  QUALIFIED_YES,
  declineReasonFromTag,
  qualifiedChoice,
  selectedDecline,
} from "@/lib/tags";

export function LeadTagFields({
  tags,
  declineReason,
  signed = false,
}: {
  tags: string[];
  declineReason?: string | null;
  signed?: boolean;
}) {
  const [qualified, setQualified] = useState(signed ? QUALIFIED_YES : qualifiedChoice(tags));
  const [decline, setDecline] = useState(signed ? "" : selectedDecline(tags));
  const reason = declineReasonFromTag(decline) ?? (decline ? declineReason : null);

  return (
    <fieldset className="space-y-3 text-sm">
      <legend className="font-medium text-slate-700">Tags</legend>
      <p className="text-slate-500">Every lead is Qualified yes or Qualified no. The other tags are only used when they fit.</p>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="qualified_tag"
            value={QUALIFIED_YES}
            checked={qualified === QUALIFIED_YES}
            onChange={() => {
              setQualified(QUALIFIED_YES);
              setDecline("");
            }}
          />
          Qualified yes
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="qualified_tag"
            value={QUALIFIED_NO}
            checked={qualified === QUALIFIED_NO}
            disabled={signed}
            onChange={() => setQualified(QUALIFIED_NO)}
          />
          Qualified no
        </label>
      </div>
      <div className="flex flex-wrap gap-4">
        {COVERAGE_TAGS.map((tag) => (
          <label key={tag} className="flex items-center gap-2">
            <input type="checkbox" name={tag} value="yes" defaultChecked={tags.includes(tag) || (signed && tag === "CVR SIGNED")} />
            {tag}
          </label>
        ))}
      </div>
      <label className="block">
        <span className="font-medium text-slate-700">Declined</span>
        <select
          name="decline_tag"
          value={decline}
          disabled={signed}
          onChange={(event) => {
            const next = event.target.value;
            setDecline(next);
            if (next) setQualified(QUALIFIED_NO);
          }}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
        >
          <option value="">No decline</option>
          {DECLINE_TAGS.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
      </label>
      <p className="text-slate-600">
        Decline reason: {reason || "Only filled when a DEC tag is used. DEC means declined."}
      </p>
    </fieldset>
  );
}
