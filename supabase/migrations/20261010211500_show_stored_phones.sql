-- Form posts were saved on phone_e164 and left the display column empty.
update public.leads
set phone = phone_e164
where (phone is null or btrim(phone) = '')
  and phone_e164 is not null;
