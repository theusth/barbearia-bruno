# Bruno Barbearia — Vercel + Supabase

Esta versão já foi preparada para usar:

- Supabase Auth (cadastro e login reais)
- PostgreSQL do Supabase
- Row Level Security (RLS)
- Painel do cliente
- Painel do proprietário
- Serviços cadastrados no banco
- Agendamentos compartilhados entre dispositivos
- Bloqueio de horário ocupado
- Cancelamento pelo cliente
- Alteração de status pelo proprietário
- Deploy estático na Vercel

## 1. Criar o projeto no Supabase

Crie um projeto novo no Supabase.

Depois abra:

SQL Editor > New query

Copie TODO o conteúdo do arquivo:

database.sql

Cole no SQL Editor e clique em Run.

Isso cria tabelas, políticas de segurança, funções e serviços iniciais.

## 2. Conectar o site ao Supabase

Abra o arquivo:

config.js

No painel do Supabase, copie:

- Project URL
- Publishable key (ou anon public key)

Preencha:

export const SUPABASE_URL = "https://SEU-PROJETO.supabase.co";
export const SUPABASE_ANON_KEY = "SUA_CHAVE_PUBLICA";

ATENÇÃO:
Nunca coloque service_role, secret key ou senha do banco no config.js.

## 3. Criar o proprietário

Primeiro abra o site e crie normalmente a conta que será do Bruno.

Depois volte ao Supabase > SQL Editor e execute:

select public.promote_owner('email-do-bruno@exemplo.com');

Troque pelo e-mail real da conta.

Depois saia do site e entre novamente. O painel será reconhecido como Proprietário.

## 4. Confirmação de e-mail

Se o Supabase estiver exigindo confirmação de e-mail, o cliente precisa clicar no e-mail recebido antes do primeiro login.

Você pode configurar isso em Authentication no painel do Supabase.

Quando o site já estiver publicado, configure a URL do seu domínio/site nas configurações de URL do Auth.

## 5. Hospedar na Vercel

Opção recomendada:

1. Crie um repositório no GitHub.
2. Envie todos os arquivos desta pasta para o repositório.
3. Entre na Vercel.
4. Clique em Add New > Project.
5. Importe o repositório.
6. Não é necessário Build Command para este projeto estático.
7. Clique em Deploy.

Arquivos que devem ir para o GitHub:

- index.html
- style.css
- app.js
- config.js
- database.sql
- vercel.json
- README.md

## 6. O que NÃO deve ser enviado

Não envie:

- senha do banco
- service_role
- secret key
- tokens administrativos

A Project URL e a Publishable/anon key são chaves próprias para uso no navegador quando o RLS está configurado.

## Teste recomendado

1. Crie uma conta de cliente.
2. Faça um agendamento.
3. Saia.
4. Entre como proprietário.
5. Veja o agendamento na agenda.
6. Marque como completed.
7. Entre novamente no cliente e confirme o status.

## Observação

O projeto usa o Supabase JavaScript v2 pelo CDN, então não precisa executar npm install para publicar a versão atual.


# ATUALIZAÇÃO: Painel do Proprietário PRO

Se você JÁ executou o `database.sql` da versão anterior, não precisa apagar nada.

No Supabase > SQL Editor:

1. Abra `update_owner_panel.sql`.
2. Copie tudo.
3. Cole no SQL Editor.
4. Clique em Run.

O painel do proprietário passa a ter:

- Visão geral com estatísticas
- Agenda completa
- Alterar status de agendamento
- Editar preço, nome, descrição e duração dos serviços
- Ativar/desativar serviços
- Cadastrar novos serviços
- Ver clientes
- Alterar telefone
- Alterar WhatsApp
- Alterar endereço
- Alterar horário de funcionamento
- Alterar Instagram
- Logs de novos agendamentos
- Logs de cancelamentos
- Logs de mudança de status
- Logs de alterações de preço/serviço
- Logs de alterações nos dados da barbearia

Os logs são visíveis somente para a conta com `role = owner`.
