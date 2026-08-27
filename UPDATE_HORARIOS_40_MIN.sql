-- ==========================================================
-- BRUNO BARBEARIA - GRADE DE HORÁRIOS 40 EM 40 MINUTOS
-- Segunda a sexta: 08:00 até 19:20
-- Sábado: 08:00 até 16:40
-- Domingo: fechado
-- Execute no Supabase > SQL Editor > Run
-- ==========================================================

create or replace function public.is_valid_barbershop_slot(
  p_date date,
  p_time time
)
returns boolean
language plpgsql
immutable
as $$
declare
  v_dow integer;
  v_minutes integer;
begin
  v_dow := extract(dow from p_date)::integer;

  -- Domingo
  if v_dow = 0 then
    return false;
  end if;

  v_minutes :=
    extract(hour from p_time)::integer * 60
    + extract(minute from p_time)::integer;

  -- Começa às 08:00
  if v_minutes < 480 then
    return false;
  end if;

  -- Somente de 40 em 40 minutos
  if mod(v_minutes - 480, 40) <> 0 then
    return false;
  end if;

  -- Sábado: último horário 16:40
  if v_dow = 6 then
    return v_minutes <= 1000;
  end if;

  -- Segunda a sexta: último horário 19:20
  return v_minutes <= 1160;
end;
$$;

create or replace function public.validate_appointment_slot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_valid_barbershop_slot(
    new.appointment_date,
    new.appointment_time
  ) then
    raise exception 'Horário fora do funcionamento da barbearia.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_appointment_slot on public.appointments;
create trigger trg_validate_appointment_slot
before insert or update of appointment_date, appointment_time
on public.appointments
for each row execute function public.validate_appointment_slot();

create or replace function public.validate_blocked_slot_time()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_valid_barbershop_slot(
    new.block_date,
    new.block_time
  ) then
    raise exception 'Horário fora do funcionamento da barbearia.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_blocked_slot_time on public.blocked_slots;
create trigger trg_validate_blocked_slot_time
before insert or update of block_date, block_time
on public.blocked_slots
for each row execute function public.validate_blocked_slot_time();

update public.business_settings
set opening_hours = 'Seg–Sex • 08:00 às 19:20 • Sáb • 08:00 às 17:00'
where id = 1;
