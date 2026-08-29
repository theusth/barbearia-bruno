
-- CORREÇÃO ISOLADA DOS HORÁRIOS FIXOS/RECORRENTES
-- Inclusive sábado (PostgreSQL: domingo=0 ... sábado=6).
-- Rode no Supabase > SQL Editor > Run.

drop function if exists public.owner_create_recurring_block(
  date,integer,time,integer,integer,text,text,text
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

  if p_weekday not between 1 and 6 then
    raise exception 'Escolha um dia entre segunda e sábado.';
  end if;

  if p_duration_days not in (30,90,120,365) then
    raise exception 'Duração inválida.';
  end if;

  if p_frequency_weeks not in (1,2) then
    raise exception 'Frequência inválida.';
  end if;

  if nullif(trim(p_reserved_for),'') is null then
    raise exception 'Informe o nome do cliente.';
  end if;

  v_end_date := p_start_date + (p_duration_days - 1);

  -- Encontra a primeira ocorrência do dia escolhido.
  -- Para sábado p_weekday=6.
  v_first_date :=
    p_start_date +
    ((p_weekday - extract(dow from p_start_date)::integer + 7) % 7);

  v_date := v_first_date;

  while v_date <= v_end_date loop
    if exists (
      select 1 from public.appointments a
      where a.appointment_date = v_date
        and a.appointment_time = p_time
        and a.status in ('confirmed','completed')
    ) or exists (
      select 1 from public.blocked_slots b
      where b.block_date = v_date
        and b.block_time = p_time
    ) then
      v_skipped := v_skipped + 1;
    else
      insert into public.blocked_slots (
        block_date, block_time, reserved_for, client_phone, notes,
        created_by, group_id, recurrence_days, recurrence_weekday,
        recurrence_frequency_weeks
      ) values (
        v_date, p_time, trim(p_reserved_for), p_client_phone, p_notes,
        auth.uid(), v_group_id, p_duration_days, p_weekday,
        p_frequency_weeks
      );
      v_created := v_created + 1;
    end if;

    v_date := v_date + (7 * p_frequency_weeks);
  end loop;

  return jsonb_build_object(
    'group_id', v_group_id,
    'created', v_created,
    'skipped', v_skipped
  );
end;
$$;

revoke all on function public.owner_create_recurring_block(
  date,integer,time,integer,integer,text,text,text
) from public;

grant execute on function public.owner_create_recurring_block(
  date,integer,time,integer,integer,text,text,text
) to authenticated;

-- TESTE: depois de criar um fixo de sábado no painel,
-- esta consulta deve mostrar as linhas gravadas.
select block_date, block_time, reserved_for, recurrence_weekday,
       recurrence_frequency_weeks, group_id
from public.blocked_slots
where extract(dow from block_date) = 6
order by block_date, block_time;
