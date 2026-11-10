-- ---------------------------------------------------------------------------
-- reorder_field_definitions: change several fields' sort_order in ONE transaction.
--
-- The app used to send one UPDATE per changed field in parallel. If one of them
-- failed (network drop, blocked by RLS) the others still applied and the order
-- was left half-changed. A function call is a single transaction: either every
-- row moves or none does.
--
-- SECURITY INVOKER: runs as the caller, so RLS still applies. RLS does not raise
-- when it blocks an UPDATE (it matches zero rows), so a row count below the
-- number of requested changes is treated as a failure and rolls everything back.
-- ---------------------------------------------------------------------------

create or replace function public.reorder_field_definitions(
  p_ids         uuid[],
  p_sort_orders integer[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed integer;
begin
  if p_ids is null or p_sort_orders is null
     or coalesce(array_length(p_ids, 1), 0) <> coalesce(array_length(p_sort_orders, 1), 0) then
    raise exception 'p_ids and p_sort_orders must have the same length';
  end if;

  if coalesce(array_length(p_ids, 1), 0) = 0 then
    return;
  end if;

  if (select count(distinct id) from unnest(p_ids) as t(id)) <> array_length(p_ids, 1) then
    raise exception 'p_ids must not contain duplicates';
  end if;

  update public.field_definitions f
     set sort_order = c.sort_order
    from unnest(p_ids, p_sort_orders) as c(id, sort_order)
   where f.id = c.id;

  get diagnostics changed = row_count;
  if changed <> array_length(p_ids, 1) then
    raise exception 'Could not reorder every field (changed % of %)', changed, array_length(p_ids, 1)
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.reorder_field_definitions(uuid[], integer[]) from anon, public;
grant execute on function public.reorder_field_definitions(uuid[], integer[]) to authenticated;
