-- Staff clients call this RPC from /work; without EXECUTE they get 403 and fall back to many touch queries.
grant execute on function public.work_queue_activity(uuid[]) to authenticated;
grant execute on function public.work_queue_activity(uuid[]) to service_role;
