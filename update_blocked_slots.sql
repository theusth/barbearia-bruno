-- BLOQUEIO DE HORÁRIOS PARA CLIENTES FIXOS

create table if not exists public.blocked_slots (
  id uuid primary key default gen_random_uuid(),
  block_date date not null,
  block_time time not null,
  reserved_for text not null,
  client_phone text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists blocked_slots_unique_slot
on public.blocked_slots (block_date, block_time);

alter table public.blocked_slots enable row level security;

drop policy if exists "blocked_slots_owner_select" on public.blocked_slots;
create policy "blocked_slots_owner_select"
on public.blocked_slots
for select
to authenticated
using (public.is_owner());

drop policy if exists "blocked_slots_owner_insert" on public.blocked_slots;
create policy "blocked_slots_owner_insert"
on public.blocked_slots
for insert
to authenticated
with check (public.is_owner() and created_by = auth.uid());

drop policy if exists "blocked_slots_owner_delete" on public.blocked_slots;
create policy "blocked_slots_owner_delete"
on public.blocked_slots
for delete
to authenticated
using (public.is_owner());

revoke all on public.blocked_slots from anon, authenticated;
grant select, insert, delete on public.blocked_slots to authenticated;

create or replace function public.prevent_block_on_booked_slot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.appointments
    where appointment_date = new.block_date
      and appointment_time = new.block_time
      and status in ('confirmed','completed')
  ) then
    raise exception 'Este horário já possui um agendamento.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_block_on_booked_slot on public.blocked_slots;
create trigger trg_prevent_block_on_booked_slot
before insert or update on public.blocked_slots
for each row execute function public.prevent_block_on_booked_slot();

create or replace function public.prevent_booking_on_blocked_slot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'confirmed' and exists (
    select 1 from public.blocked_slots
    where block_date = new.appointment_date
      and block_time = new.appointment_time
  ) then
    raise exception 'Este horário está reservado e não pode ser agendado.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_booking_on_blocked_slot on public.appointments;
create trigger trg_prevent_booking_on_blocked_slot
before insert or update of appointment_date, appointment_time, status
on public.appointments
for each row execute function public.prevent_booking_on_blocked_slot();

create or replace function public.get_booked_times(p_date date)
returns table (appointment_time time)
language sql
stable
security definer
set search_path = public
as $$
  select x.appointment_time
  from (
    select appointment_time
    from public.appointments
    where appointment_date = p_date
      and status in ('confirmed','completed')
    union
    select block_time
    from public.blocked_slots
    where block_date = p_date
  ) x
  order by x.appointment_time;
$$;

revoke all on function public.get_booked_times(date) from public;
grant execute on function public.get_booked_times(date) to anon, authenticated;
