-- ==========================================================
-- CORREÇÃO: AGENDAMENTO MANUAL RESPEITAR HORÁRIOS BLOQUEADOS
-- Execute no Supabase > SQL Editor > Run
-- ==========================================================

alter table public.blocked_slots enable row level security;

drop policy if exists "blocked_slots_owner_select" on public.blocked_slots;

create policy "blocked_slots_owner_select"
on public.blocked_slots
for select
to authenticated
using (public.is_owner());

grant select on public.blocked_slots to authenticated;

-- Garante também que a função de disponibilidade considera
-- agendamentos + horários bloqueados.
create or replace function public.get_booked_times(p_date date)
returns table (appointment_time time)
language sql
stable
security definer
set search_path = public
as $$
  select x.appointment_time
  from (
    select a.appointment_time
    from public.appointments a
    where a.appointment_date = p_date
      and a.status in ('confirmed','completed')

    union

    select b.block_time as appointment_time
    from public.blocked_slots b
    where b.block_date = p_date
  ) x
  order by x.appointment_time;
$$;

revoke all on function public.get_booked_times(date) from public;
grant execute on function public.get_booked_times(date) to anon, authenticated;
