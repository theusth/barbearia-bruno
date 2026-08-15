-- ==========================================================
-- BLOQUEIO RECORRENTE DE HORÁRIOS
-- Rode no Supabase > SQL Editor depois do update_blocked_slots.sql
-- ==========================================================

alter table public.blocked_slots
  add column if not exists group_id uuid,
  add column if not exists recurrence_days integer,
  add column if not exists recurrence_weekday integer;

-- Agrupa bloqueios antigos individualmente.
update public.blocked_slots
set group_id = gen_random_uuid()
where group_id is null;

-- Cria uma série: ex. toda terça às 15h por 90 dias.
create or replace function public.owner_create_recurring_block(
  p_start_date date,
  p_weekday integer,
  p_time time,
  p_duration_days integer,
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

  if p_start_date < current_date then
    raise exception 'A data inicial não pode estar no passado.';
  end if;

  if nullif(trim(p_reserved_for),'') is null then
    raise exception 'Informe o nome do cliente.';
  end if;

  v_end_date := p_start_date + (p_duration_days - 1);

  for v_date in
    select d::date
    from generate_series(
      p_start_date::timestamp,
      v_end_date::timestamp,
      interval '1 day'
    ) d
    where extract(dow from d)::integer = p_weekday
  loop
    -- Se já houver agendamento ou bloqueio nesse horário, ignora essa ocorrência.
    if exists (
      select 1
      from public.appointments a
      where a.appointment_date = v_date
        and a.appointment_time = p_time
        and a.status in ('confirmed','completed')
    ) or exists (
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
        recurrence_weekday
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
        p_weekday
      );

      v_created := v_created + 1;
    end if;
  end loop;

  if v_created = 0 then
    raise exception 'Nenhum horário pôde ser bloqueado. Todos os horários da série já estão ocupados.';
  end if;

  return jsonb_build_object(
    'group_id', v_group_id,
    'created', v_created,
    'skipped', v_skipped,
    'start_date', p_start_date,
    'end_date', v_end_date
  );
end;
$$;

revoke all on function public.owner_create_recurring_block(date,integer,time,integer,text,text,text) from public;
grant execute on function public.owner_create_recurring_block(date,integer,time,integer,text,text,text) to authenticated;

-- Libera uma série inteira.
create or replace function public.owner_delete_block_group(p_group_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_owner() then
    raise exception 'Acesso negado.';
  end if;

  delete from public.blocked_slots
  where group_id = p_group_id;

  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke all on function public.owner_delete_block_group(uuid) from public;
grant execute on function public.owner_delete_block_group(uuid) to authenticated;

-- Garante que a disponibilidade dos clientes continue considerando
-- tanto agendamentos quanto bloqueios recorrentes.
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
