-- ==========================================================
-- BRUNO BARBEARIA - AGENDAMENTO MANUAL PELO PROPRIETÁRIO
-- Permite marcar para pessoas sem conta, celular ou e-mail.
-- Execute no Supabase > SQL Editor > Run.
-- ==========================================================

-- Cliente cadastrado deixa de ser obrigatório para agendamentos feitos pelo dono.
alter table public.appointments
  alter column client_id drop not null;

alter table public.appointments
  add column if not exists manual_client_name text,
  add column if not exists manual_client_phone text,
  add column if not exists created_by_owner uuid references public.profiles(id) on delete set null;

-- Proteção: um agendamento deve ser de um cliente cadastrado OU possuir nome manual.
alter table public.appointments
  drop constraint if exists appointments_client_identity_check;

alter table public.appointments
  add constraint appointments_client_identity_check
  check (
    client_id is not null
    or nullif(trim(manual_client_name), '') is not null
  );

-- Função segura: somente o proprietário pode criar agendamento manual.
create or replace function public.owner_create_manual_appointment(
  p_client_name text,
  p_client_phone text,
  p_service_id bigint,
  p_date date,
  p_time time,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_service_name text;
begin
  if not public.is_owner() then
    raise exception 'Acesso negado.';
  end if;

  if nullif(trim(p_client_name), '') is null then
    raise exception 'Informe o nome da pessoa.';
  end if;

  if p_date < current_date then
    raise exception 'A data não pode estar no passado.';
  end if;

  if not exists (
    select 1
    from public.services
    where id = p_service_id
      and active = true
  ) then
    raise exception 'Serviço inválido.';
  end if;

  -- Bloqueios recorrentes e horários já ocupados também são respeitados.
  if exists (
    select 1
    from public.blocked_slots
    where block_date = p_date
      and block_time = p_time
  ) then
    raise exception 'Este horário está bloqueado.';
  end if;

  if exists (
    select 1
    from public.appointments
    where appointment_date = p_date
      and appointment_time = p_time
      and status in ('confirmed','completed')
  ) then
    raise exception 'Este horário já está ocupado.';
  end if;

  insert into public.appointments (
    client_id,
    service_id,
    appointment_date,
    appointment_time,
    status,
    notes,
    manual_client_name,
    manual_client_phone,
    created_by_owner
  )
  values (
    null,
    p_service_id,
    p_date,
    p_time,
    'confirmed',
    p_notes,
    trim(p_client_name),
    nullif(trim(coalesce(p_client_phone, '')), ''),
    auth.uid()
  )
  returning id into v_id;

  select name
  into v_service_name
  from public.services
  where id = p_service_id;

  -- Log adicional específico para identificar que foi o proprietário.
  perform public.write_activity_log(
    auth.uid(),
    'manual_appointment_created',
    'appointment',
    v_id::text,
    'Proprietário marcou horário para ' || trim(p_client_name) ||
      ' • ' || to_char(p_date, 'DD/MM/YYYY') ||
      ' às ' || to_char(p_time, 'HH24:MI') ||
      coalesce(' • ' || v_service_name, ''),
    jsonb_build_object(
      'client_name', trim(p_client_name),
      'client_phone', p_client_phone,
      'date', p_date,
      'time', p_time,
      'service_id', p_service_id
    )
  );

  return v_id;
end;
$$;

revoke all on function public.owner_create_manual_appointment(
  text,text,bigint,date,time,text
) from public;

grant execute on function public.owner_create_manual_appointment(
  text,text,bigint,date,time,text
) to authenticated;

-- A consulta de horários disponíveis já considera todos os registros
-- da tabela appointments, incluindo os agendados manualmente.
