-- ==========================================================
-- BRUNO BARBEARIA - NOVA GRADE DE HORÁRIOS
-- Segunda a sexta: 08:00 até 19:20, de 40 em 40 minutos
-- Sábado: 08:00 até 16:40, de 40 em 40 minutos
-- Domingo: fechado
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

  -- Domingo fechado.
  if v_dow = 0 then
    return false;
  end if;

  v_minutes :=
    extract(hour from p_time)::integer * 60
    + extract(minute from p_time)::integer;

  -- Grade começa às 08:00 e avança de 40 em 40 minutos.
  if v_minutes < 480 then
    return false;
  end if;

  if mod(v_minutes - 480, 40) <> 0 then
    return false;
  end if;

  -- Sábado: último início 16:40.
  if v_dow = 6 then
    return v_minutes <= 1000;
  end if;

  -- Segunda a sexta: último início 19:20.
  return v_minutes <= 1160;
end;
$$;

-- Impede agendamentos fora da grade.
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

-- Impede bloqueios fora da grade.
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

-- Atualiza a informação pública no painel.
update public.business_settings
set opening_hours = 'Seg–Sex • 08:00 às 20:00 • Sáb até 17:00'
where id = 1;
