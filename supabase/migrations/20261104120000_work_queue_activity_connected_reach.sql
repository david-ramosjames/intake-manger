-- Initial Contact stays until a real reply or a connected call.
-- Voicemail / no-connect / short outbound summaries must not flip `talked`.

create or replace function public.work_queue_activity(lead_ids uuid[])
returns table (
  lead_id uuid,
  calls integer,
  texts integer,
  talked boolean,
  called_out boolean,
  last_at timestamp with time zone,
  quo_link text,
  slack_permalink text,
  phone_last_at timestamp with time zone,
  phone_quo_link text,
  phone_slack_permalink text
)
language sql
stable
as $function$
  with open as (
    select l.id,
      case
        when length(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g')) >= 10
          then right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 10)
        else ''
      end as tail
    from public.leads l
    where l.id = any(lead_ids)
  ),
  primary_touch as (
    select i.id,
      i.lead_id,
      lower(coalesce(i.type, '')) as type,
      lower(coalesce(i.direction, '')) as direction,
      coalesce(i.content, '') as content,
      i.occurred_at,
      i.quo_link,
      i.slack_permalink,
      case
        when length(regexp_replace(coalesce(i.phone, ''), '\D', '', 'g')) >= 10
          then right(regexp_replace(coalesce(i.phone, ''), '\D', '', 'g'), 10)
        else ''
      end as tail
    from public.intake_interactions i
    where i.lead_id = any(lead_ids)
  ),
  attributed as (
    select o.id as owner_id, t.id as touch_id, t.type, t.direction, t.content, t.occurred_at, t.quo_link, t.slack_permalink
    from primary_touch t
    join open o on o.id = t.lead_id or (o.tail <> '' and o.tail = t.tail)
  ),
  primary_agg as (
    select owner_id,
      count(distinct touch_id) filter (where type in ('call', 'sona_call', 'missed_call'))::int as calls,
      count(distinct touch_id) filter (where type = 'text')::int as texts,
      bool_or(
        (
          direction in ('inbound', 'incoming')
          and type in ('text', 'email')
          and length(trim(content)) >= 2
          and lower(trim(regexp_replace(content, '[^a-zA-Z\s]', '', 'g')))
            not in ('stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'no', 'no thanks', 'no thank you')
        )
        or (
          type in ('call', 'sona_call')
          and content !~* '(voicemail|voice mail|left (a |your )?(message|voicemail)|after the (tone|beep)|mailbox is full|please leave (a |your )?message|no answer|not answered|didn.?t answer|did not answer|went to voicemail|was not answered|unable to reach|nobody answered|no one answered|forwarded to voicemail|no connect|no actionable details|nothing to summarize|no details to summarize|no transcript received)'
          and (
            direction in ('inbound', 'incoming')
            or length(trim(content)) >= 120
          )
        )
      ) as talked,
      bool_or(type = 'call' and direction = 'outbound') as called_out,
      max(occurred_at) filter (where type in ('call', 'sona_call', 'text', 'voicemail')) as last_at,
      (array_agg(quo_link order by occurred_at desc nulls last) filter (where quo_link is not null and quo_link <> ''))[1] as quo_link,
      (array_agg(slack_permalink order by occurred_at desc nulls last) filter (where slack_permalink is not null and slack_permalink <> ''))[1] as slack_permalink
    from attributed
    group by owner_id
  ),
  missing_tails as (
    select distinct o.tail
    from open o
    left join primary_agg p on p.owner_id = o.id
    where o.tail <> '' and p.last_at is null
  ),
  phone_touch as (
    select o.id as owner_id,
      i.occurred_at,
      i.quo_link,
      i.slack_permalink,
      lower(coalesce(i.type, '')) as type
    from public.intake_interactions i
    join open o on o.tail <> '' and o.tail in (select tail from missing_tails) and o.tail = case
      when length(regexp_replace(coalesce(i.phone_e164, i.phone, ''), '\D', '', 'g')) >= 10
        then right(regexp_replace(coalesce(i.phone_e164, i.phone, ''), '\D', '', 'g'), 10)
      else ''
    end
    where i.lead_id is null or not (i.lead_id = any(lead_ids))
  ),
  phone_agg as (
    select owner_id,
      max(occurred_at) filter (where type in ('call', 'sona_call', 'text', 'voicemail')) as last_at,
      (array_agg(quo_link order by occurred_at desc nulls last) filter (where type in ('call', 'sona_call', 'text', 'voicemail') and quo_link is not null and quo_link <> ''))[1] as quo_link,
      (array_agg(slack_permalink order by occurred_at desc nulls last) filter (where type in ('call', 'sona_call', 'text', 'voicemail') and slack_permalink is not null and slack_permalink <> ''))[1] as slack_permalink
    from phone_touch
    group by owner_id
  )
  select o.id,
    coalesce(p.calls, 0),
    coalesce(p.texts, 0),
    coalesce(p.talked, false),
    coalesce(p.called_out, false),
    p.last_at,
    p.quo_link,
    p.slack_permalink,
    s.last_at,
    s.quo_link,
    s.slack_permalink
  from open o
  left join primary_agg p on p.owner_id = o.id
  left join phone_agg s on s.owner_id = o.id
  where p.owner_id is not null or s.owner_id is not null;
$function$;

grant execute on function public.work_queue_activity(uuid[]) to authenticated;
grant execute on function public.work_queue_activity(uuid[]) to service_role;
