-- BRUNO BARBEARIA - CADASTRO SEM E-MAIL OBRIGATÓRIO
-- Não é necessário ativar Phone Provider/Twilio.
-- No Supabase, em Authentication > Providers > Email,
-- deixe "Confirm email" DESATIVADO.

alter table public.profiles
  add column if not exists phone text;

select id, name, phone, role, created_at
from public.profiles
order by created_at desc;
