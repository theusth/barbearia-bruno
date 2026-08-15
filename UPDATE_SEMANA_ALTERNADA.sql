-- ==========================================================
-- BRUNO BARBEARIA
-- ATUALIZAÇÃO: TODA SEMANA / SEMANA SIM, SEMANA NÃO
-- Execute no Supabase > SQL Editor > Run
-- ==========================================================

alter table public.blocked_slots
  add column if not exists recurrence_frequency_weeks integer not null default 1;

-- Remove a versão antiga para evitar conflito de assinatura.
drop function if exists public.owner_create_recurring_block(
  date, integer, time, integer, text, text, text
);

drop function if exists public.owner_create_recurring_block(
  date, integer, time, integer, integer, text, text, text
);

create or replace function public.owner_create_recurring_block(
  p_start_date date,
  p_weekday integer,
  p_time time,
  p_duration_days integer,
  p_frequency_weeks integer,
  p_reserved_for text,
  p_client_phone text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_date date;
  v_date date;
  v_end_date date;
  v_group_id uuid := gen_random_uuid();
  v_created integer := 0;
  v_skipped integer := 0;
begin
  if not public.is_owner() then
    raise exception 'Acesso negado.';
  end if;

  if p_weekday not between 0 and 6 then
    raise exception 'Dia da semana inválido.';
  end if;

  if p_duration_days not in (30,90,120,365) then
    raise exception 'Duração inválida.';
  end if;

  if p_frequency_weeks not in (1,2) then
    raise exception 'Frequência inválida.';
  end if;

  if p_start_date < current_date then
    raise exception 'A data inicial não pode estar no passado.';
  end if;

  if nullif(trim(p_reserved_for),'') is null then
    raise exception 'Informe o nome do cliente.';
  end if;

  v_end_date := p_start_date + (p_duration_days - 1);

  -- Primeiro dia escolhido da semana a partir da data inicial.
  v_first_date :=
    p_start_date
    + ((p_weekday - extract(dow from p_start_date)::integer + 7) % 7);

  -- 7 dias = toda semana
  -- 14 dias = semana sim, semana não
  for v_date in
    select d::date
    from generate_series(
      v_first_date::timestamp,
      v_end_date::timestamp,
      make_interval(days => 7 * p_frequency_weeks)
    ) d
  loop

    if exists (
      select 1
      from public.appointments a
      where a.appointment_date = v_date
        and a.appointment_time = p_time
        and a.status in ('confirmed','completed')
    )
    or exists (
      select 1
      from public.blocked_slots b
      where b.block_date = v_date
        and b.block_time = p_time
    ) then
      v_skipped := v_skipped + 1;

    else
      insert into public.blocked_slots (
        block_date,
        block_time,
        reserved_for,
        client_phone,
        notes,
        created_by,
        group_id,
        recurrence_days,
        recurrence_weekday,
        recurrence_frequency_weeks
      )
      values (
        v_date,
        p_time,
        trim(p_reserved_for),
        p_client_phone,
        p_notes,
        auth.uid(),
        v_group_id,
        p_duration_days,
        p_weekday,
        p_frequency_weeks
      );

      v_created := v_created + 1;
    end if;
  end loop;

  if v_created = 0 then
    raise exception 'Nenhum horário pôde ser bloqueado. Os horários da série já estão ocupados.';
  end if;

  return jsonb_build_object(
    'group_id', v_group_id,
    'created', v_created,
    'skipped', v_skipped,
    'frequency_weeks', p_frequency_weeks,
    'start_date', p_start_date,
    'end_date', v_end_date
  );
end;
$$;

revoke all on function public.owner_create_recurring_block(
  date,integer,time,integer,integer,text,text,text
) from public;

grant execute on function public.owner_create_recurring_block(
  date,integer,time,integer,integer,text,text,text
) to authenticated;

-- Disponibilidade continua considerando bloqueios e agendamentos.
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

    select b.block_time
    from public.blocked_slots b
    where b.block_date = p_date
  ) x
  order by x.appointment_time;
$$;

revoke all on function public.get_booked_times(date) from public;
grant execute on function public.get_booked_times(date) to anon, authenticated;
