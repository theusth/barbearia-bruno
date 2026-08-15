# Bruno Barbearia — Versão Final

## O que já está incluído

- Site público moderno
- Supabase Auth
- Painel do cliente
- Painel do proprietário
- Serviços e preços editáveis
- Clientes
- Agenda completa
- Logs
- Telefone, WhatsApp, endereço, Instagram e horários editáveis
- Bloqueio manual de horários
- Bloqueio recorrente para clientes fixos
- Recorrência de 30, 90, 120 dias ou 1 ano
- Escolha de dia da semana e horário
- Liberar somente uma ocorrência
- Liberar a série inteira
- Horário bloqueado aparece como ocupado para clientes
- Vercel + GitHub

## Para atualizar seu projeto atual

### GitHub
Substitua estes arquivos pelos deste pacote:

- app.js
- style.css

Você também pode substituir os demais arquivos se quiser deixar o repositório igual ao pacote final.

### Supabase
Abra:

SQL Editor > New Query

Cole TODO o conteúdo de:

`UPDATE_TUDO_SUPABASE.sql`

e clique em Run.

### Vercel
Depois do Commit no GitHub, a Vercel deve criar um novo deploy automaticamente.

## Configuração

O arquivo `config.js` continua usando:

- SUPABASE_URL
- SUPABASE_ANON_KEY / Publishable key

Nunca coloque service_role ou secret key no navegador.
