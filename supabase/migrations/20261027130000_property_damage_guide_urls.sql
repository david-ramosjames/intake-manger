alter table public.intake_settings
  add column if not exists property_damage_guide_url_en text,
  add column if not exists property_damage_guide_url_es text;

comment on column public.intake_settings.property_damage_guide_url_en is
  'English property-damage guide PDF URL sent on that referral type.';
comment on column public.intake_settings.property_damage_guide_url_es is
  'Spanish property-damage guide PDF URL sent on that referral type.';
