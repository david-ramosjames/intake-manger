"use client";

import { useState } from "react";
import {
  DECLINE_TAGS,
  NOT_QUALIFIED_TAGS,
  QUALIFIED_NO,
  QUALIFIED_YES,
  SIZE_TAGS,
  TAG_LABEL,
  TYPE_TAGS,
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
}: {
  tags: string[];
  declineReason?: string | null;
  signed?: boolean;
  desired?: boolean;
  nonPi?: boolean;
  callrail?: boolean;
}) {
  const [qualified, setQualified] = useState(qualifiedChoice(tags));
  const [decline, setDecline] = useState(signed ? "" : selectedDecline(tags));
  const [notQualified, setNotQualified] = useState(selectedOne(tags, NOT_QUALIFIED_TAGS));
  const [size, setSize] = useState(selectedOne(tags, SIZE_TAGS));
  const [injuryType, setInjuryType] = useState(selectedOne(tags, TYPE_TAGS));
  const reason = declineReasonFromTag(decline) ?? (decline ? declineReason : null);
  const showSize = desired || signed;
  const showType = !nonPi && notQualified !== "NQ: Non-PI Legal Matter";

  return (
    <fieldset className="space-y-3 text-sm">
      <legend className="font-medium text-slate-700">Qualified</legend>
      <p className="text-slate-500">
        Every lead is Qualified YES or Qualified NO. A non-PI matter, a case outside the service area, and an unresponsive lead are Qualified NO.
      </p>
      {nonPi ? <input type="hidden" name="non_pi" value="yes" /> : null}
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
      <label className="block">
        <span className="font-medium text-slate-700">Declined</span>
        <select
          name="decline_tag"
          value={decline}
          disabled={signed}
          onChange={(event) => setDecline(event.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
        >
          <option value="">No decline</option>
          {DECLINE_TAGS.map((tag) => (
            <option key={tag} value={tag}>
              {TAG_LABEL[tag]}
            </option>
          ))}
        </select>
      </label>
      <p className="text-slate-600">
        Decline reason: {reason || "Only filled when a DEC tag is used. DEC means declined."}
      </p>
      <label className="block">
        <span className="font-medium text-slate-700">Not qualified</span>
        <select
          name="not_qualified_tag"
          value={notQualified}
          onChange={(event) => {
            setNotQualified(event.target.value);
            if (event.target.value) setQualified(QUALIFIED_NO);
          }}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
        >
          <option value="">None</option>
          {NOT_QUALIFIED_TAGS.filter((tag) => tag !== "NQ: Spam / Robo Call").map((tag) => (
            <option key={tag} value={tag}>
              {TAG_LABEL[tag]}
            </option>
          ))}
        </select>
      </label>
      {showSize ? (
        <label className="block">
          <span className="font-medium text-slate-700">Size</span>
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
      {showType ? (
        <label className="block">
          <span className="font-medium text-slate-700">Injury type</span>
          <select
            name="injury_type"
            value={injuryType}
            onChange={(event) => setInjuryType(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
          >
            <option value="">No type</option>
            {TYPE_TAGS.map((tag) => (
              <option key={tag} value={tag}>
                {TAG_LABEL[tag]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <p className="text-slate-500">
        {callrail
          ? "Saving writes these tags onto the CallRail call and leaves its other tags in place."
          : "This lead has no CallRail call stored, so the tags stay in Intake Manager."}
      </p>
    </fieldset>
  );
}
