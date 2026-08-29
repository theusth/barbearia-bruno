import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const CONFIGURED =
  SUPABASE_URL.startsWith("https://") &&
  !SUPABASE_URL.includes("COLE_") &&
  SUPABASE_ANON_KEY.length > 20 &&
  !SUPABASE_ANON_KEY.includes("COLE_");

const supabase = CONFIGURED
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage,
        storageKey: "bruno-barbearia-auth"
      }
    })
  : null;

const WEEKDAY_TIMES = [
  "08:00","08:40","09:20","10:00","10:40","11:20",
  "12:00","12:40","13:20","14:00","14:40","15:20",
  "16:00","16:40","17:20","18:00","18:40","19:20"
];

const SATURDAY_TIMES = [
  "08:00","08:40","09:20","10:00","10:40","11:20",
  "12:00","12:40","13:20","14:00","14:40","15:20",
  "16:00","16:40"
];

const TIMES = WEEKDAY_TIMES;

function getTimesForWeekday(weekday) {
  if (Number(weekday) === 0) return [];
  if (Number(weekday) === 6) return SATURDAY_TIMES;
  return WEEKDAY_TIMES;
}

function getTimesForDate(dateString) {
  if (!dateString) return WEEKDAY_TIMES;
  const date = new Date(`${dateString}T12:00:00`);
  return getTimesForWeekday(date.getDay());
}

function refreshBlockTimes() {
  const weekday = Number($("#blockWeekday")?.value ?? 1);
  const select = $("#blockTime");
  if (!select) return;

  const times = getTimesForWeekday(weekday);

  select.innerHTML = times.length
    ? times.map(t => `<option value="${t}">${t}</option>`).join("")
    : `<option value="">Fechado</option>`;
}
const STATUS_LABELS = {
  confirmed: "Confirmado",
  completed: "Concluído",
  cancelled: "Cancelado",
  no_show: "Não compareceu"
};

let state = {
  user: null,
  profile: null,
  services: [],
  appointments: [],
  business: null,
  logs: [],
  ownerStats: null,
  blockedSlots: [],
  manualSelectedTime: null,
  agendaSelectedDate: new Date().toISOString().slice(0,10),
  dashView: "overview",
  selectedTime: null
};

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const money = n => Number(n || 0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const fmtDate = d => new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR");
const serviceById = id => state.services.find(s => Number(s.id) === Number(id));

function showToast(message, error=false) {
  const t = $("#toast");
  t.textContent = message;
  t.classList.toggle("error", error);
  t.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => t.classList.remove("show"), 3200);
}

function showConfigWarning() {
  $("#servicesGrid").innerHTML = `
    <div class="config-warning" style="grid-column:1/-1">
      <strong>Falta conectar o Supabase.</strong><br>
      Abra <code>config.js</code>, cole a Project URL e a Publishable/anon key do seu projeto e recarregue a página.
    </div>`;
}

function openModal(id) {
  $(`#${id}`).classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
function closeModal(id) {
  $(`#${id}`).classList.add("hidden");
  document.body.style.overflow = "";
}

function authTab(tab) {
  $$("[data-auth-tab]").forEach(b => b.classList.toggle("active", b.dataset.authTab === tab));
  $("#loginForm").classList.toggle("hidden", tab !== "login");
  $("#registerForm").classList.toggle("hidden", tab !== "register");
}

function serviceCard(s, owner=false) {
  return `<article class="service-card">
    <div class="service-icon">✂</div>
    <h3>${escapeHtml(s.name)}</h3>
    <p>${escapeHtml(s.description || "")}</p>
    <div class="service-meta">
      <div><span>${Number(s.duration_minutes)} MIN</span><strong>${money(s.price)}</strong></div>
      ${owner
        ? `<div class="service-actions">
             <button class="mini-btn" onclick="window.editService(${s.id})">Editar</button>
             <button class="mini-btn" onclick="window.toggleService(${s.id}, ${!s.active})">${s.active ? "Desativar" : "Ativar"}</button>
           </div>`
        : `<button class="mini-btn" onclick="window.openBooking(${s.id})">Agendar →</button>`}
    </div>
  </article>`;
}

function renderServices() {
  if (!CONFIGURED) return showConfigWarning();
  const publicServices = state.services.filter(s => s.active);
  $("#servicesGrid").innerHTML = publicServices.length
    ? publicServices.map(s => serviceCard(s)).join("")
    : `<div class="loading-card" style="grid-column:1/-1">Nenhum serviço disponível.</div>`;
  $("#bookingService").innerHTML = publicServices.map(s =>
    `<option value="${s.id}">${escapeHtml(s.name)} — ${money(s.price)}</option>`
  ).join("");
  updateBookingSummary();
}

async function loadServices() {
  if (!CONFIGURED) return;
  const { data, error } = await supabase
    .from("services")
    .select("id,name,description,price,duration_minutes,active,sort_order")
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    console.error(error);
    showToast("Não foi possível carregar os serviços.", true);
    return;
  }
  state.services = data || [];
  renderServices();
}

async function loadProfile() {
  if (!state.user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id,name,phone,role,created_at")
    .eq("id", state.user.id)
    .single();
  if (error) {
    console.error(error);
    showToast("Não foi possível carregar seu perfil.", true);
    return null;
  }
  state.profile = data;
  return data;
}

async function loadAppointments() {
  if (!state.user) return;

  const fullSelect = `
    id, client_id, service_id, appointment_date, appointment_time,
    status, notes, created_at, manual_client_name, manual_client_phone, created_by_owner,
    services ( id, name, price, duration_minutes ),
    profiles ( id, name, phone )
  `;

  const basicSelect = `
    id, client_id, service_id, appointment_date, appointment_time,
    status, notes, created_at,
    services ( id, name, price, duration_minutes ),
    profiles ( id, name, phone )
  `;

  let { data, error } = await supabase
    .from("appointments")
    .select(fullSelect)
    .order("appointment_date", { ascending: true })
    .order("appointment_time", { ascending: true });

  // Se o banco ainda não tiver as colunas de agendamento manual,
  // carrega a agenda normal em vez de deixar a página vazia.
  if (error) {
    console.warn("Consulta completa da agenda falhou; tentando modo compatível.", error);

    const fallback = await supabase
      .from("appointments")
      .select(basicSelect)
      .order("appointment_date", { ascending: true })
      .order("appointment_time", { ascending: true });

    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    console.error(error);
    showToast("Não foi possível carregar os agendamentos.", true);
    return;
  }

  state.appointments = (data || []).map(a => ({
    manual_client_name: null,
    manual_client_phone: null,
    created_by_owner: null,
    ...a
  }));
}


async function loadBusinessSettings() {
  if (!CONFIGURED) return;
  const { data, error } = await supabase
    .from("business_settings")
    .select("id,shop_name,phone,whatsapp,address,opening_hours,instagram,updated_at")
    .eq("id", 1)
    .single();
  if (error) {
    console.error(error);
    return;
  }
  state.business = data;
  if ($("#publicPhone")) $("#publicPhone").textContent = data.phone || "";
  if ($("#publicAddress")) $("#publicAddress").textContent = data.address || "";
  if ($("#publicHours")) $("#publicHours").textContent = data.opening_hours || "";
}

async function loadOwnerLogs(limit=200) {
  if (!state.profile || state.profile.role !== "owner") return;
  const { data, error } = await supabase
    .from("activity_logs")
    .select("id,actor_id,actor_name,actor_role,action,entity_type,entity_id,description,metadata,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error(error);
    showToast("Não foi possível carregar os logs.", true);
    return;
  }
  state.logs = data || [];
}

async function loadOwnerStats() {
  if (!state.profile || state.profile.role !== "owner") return;
  const { data, error } = await supabase.rpc("owner_dashboard_stats");
  if (error) {
    console.error(error);
    return;
  }
  state.ownerStats = data || null;
}

async function saveBusinessSettings() {
  if (state.profile?.role !== "owner") return;
  const payload = {
    shop_name: $("#ownerShopName").value.trim(),
    phone: $("#ownerPhone").value.trim(),
    whatsapp: $("#ownerWhatsapp").value.trim(),
    address: $("#ownerAddress").value.trim(),
    opening_hours: $("#ownerHours").value.trim(),
    instagram: $("#ownerInstagram").value.trim() || null
  };
  const { error } = await supabase
    .from("business_settings")
    .update(payload)
    .eq("id", 1);
  if (error) return showToast(error.message || "Não foi possível salvar.", true);
  await Promise.all([loadBusinessSettings(), loadOwnerLogs()]);
  showToast("Dados da barbearia atualizados.");
  renderDashboard();
}

function logTitle(action) {
  const map = {
    appointment_created:"Novo agendamento",
    manual_appointment_created:"Agendamento feito pelo proprietário",
    appointment_cancelled:"Agendamento cancelado",
    appointment_status_changed:"Status alterado",
    service_created:"Serviço criado",
    service_updated:"Serviço alterado",
    service_deleted:"Serviço removido",
    business_settings_updated:"Dados da barbearia alterados",
    slot_blocked:"Horário bloqueado",
    slot_unblocked:"Horário liberado"
  };
  return map[action] || action;
}

function renderLogList(logs) {
  if (!logs.length) return empty("Nenhum log encontrado","As atividades aparecerão aqui.");
  return `<div class="log-list">${logs.map(l=>`
    <div class="log-item">
      <span class="log-dot"></span>
      <div>
        <strong>${escapeHtml(logTitle(l.action))}</strong>
        <p>${escapeHtml(l.description || "")}<br>
        ${l.actor_name ? `Responsável: ${escapeHtml(l.actor_name)} (${escapeHtml(l.actor_role || "")})` : "Ação automática do sistema"}</p>
      </div>
      <time>${new Date(l.created_at).toLocaleString("pt-BR")}</time>
    </div>`).join("")}</div>`;
}

function filterOwnerLogs() {
  const term = ($("#logSearch")?.value || "").trim().toLowerCase();
  const type = $("#logType")?.value || "all";
  let logs = [...state.logs];
  if (type !== "all") logs = logs.filter(l => l.entity_type === type || l.action.startsWith(type));
  if (term) {
    logs = logs.filter(l =>
      `${l.actor_name||""} ${l.action||""} ${l.description||""} ${l.entity_type||""}`
        .toLowerCase().includes(term)
    );
  }
  $("#logsContainer").innerHTML = renderLogList(logs);
}


async function loadBlockedSlots() {
  if (!state.profile || state.profile.role !== "owner") return;

  const { data, error } = await supabase
    .from("blocked_slots")
    .select("id,block_date,block_time,reserved_for,client_phone,notes,created_by,created_at,group_id,recurrence_days,recurrence_weekday,recurrence_frequency_weeks")
    .order("block_date", { ascending: true })
    .order("block_time", { ascending: true });

  if (error) {
    console.error(error);
    showToast("Não foi possível carregar os horários bloqueados.", true);
    return;
  }

  state.blockedSlots = data || [];
}

async function createBlockedSlot() {
  if (state.profile?.role !== "owner") return;

  const start_date = $("#blockStartDate")?.value;
  const weekday = Number($("#blockWeekday")?.value);
  const block_time = $("#blockTime")?.value;
  const duration_days = Number($("#blockDuration")?.value);
  const frequency_weeks = Number($("#blockFrequency")?.value || 1);
  const reserved_for = $("#blockClient")?.value.trim();
  const client_phone = $("#blockPhone")?.value.trim() || null;
  const notes = $("#blockNotes")?.value.trim() || null;

  if (!start_date || Number.isNaN(weekday) || !block_time || !duration_days || ![1,2].includes(frequency_weeks) || !reserved_for) {
    return showToast("Preencha início, dia da semana, horário, duração e cliente.", true);
  }

  if (weekday === 0) {
    return showToast("A barbearia fica fechada aos domingos.", true);
  }

  if (!getTimesForWeekday(weekday).includes(block_time)) {
    return showToast("Esse horário não existe para o dia escolhido.", true);
  }

  const { data, error } = await supabase.rpc("owner_create_recurring_block", {
    p_start_date: start_date,
    p_weekday: weekday,
    p_time: block_time,
    p_duration_days: duration_days,
    p_frequency_weeks: frequency_weeks,
    p_reserved_for: reserved_for,
    p_client_phone: client_phone,
    p_notes: notes
  });

  if (error) {
    console.error(error);
    return showToast(error.message || "Não foi possível criar o bloqueio recorrente.", true);
  }

  await Promise.all([loadBlockedSlots(), loadOwnerLogs()]);
  renderDashboard();

  const result = data || {};
  const created = result.created ?? 0;
  const skipped = result.skipped ?? 0;

  showToast(
    skipped
      ? `Série criada: ${created} horários bloqueados e ${skipped} conflitos ignorados.`
      : `Série criada com ${created} horários bloqueados.`
  );
}

async function deleteBlockedSlot(id) {
  if (!confirm("Deseja liberar este horário?")) return;

  const { error } = await supabase
    .from("blocked_slots")
    .delete()
    .eq("id", id);

  if (error) {
    console.error(error);
    return showToast(error.message || "Não foi possível liberar o horário.", true);
  }

  await Promise.all([loadBlockedSlots(), loadOwnerLogs()]);
  renderDashboard();
  showToast("Horário liberado.");
}


async function deleteBlockedSeries(groupId) {
  if (!groupId) return;
  if (!confirm("Deseja liberar TODOS os horários desta série?")) return;

  const { data, error } = await supabase.rpc("owner_delete_block_group", {
    p_group_id: groupId
  });

  if (error) {
    console.error(error);
    return showToast(error.message || "Não foi possível liberar a série.", true);
  }

  await Promise.all([loadBlockedSlots(), loadOwnerLogs()]);
  renderDashboard();
  showToast(`${data ?? 0} horários da série foram liberados.`);
}

function renderBlockedSlots() {
  const today = new Date().toISOString().slice(0,10);
  const future = state.blockedSlots.filter(b => b.block_date >= today);

  const weekdays = [
    [1,"Segunda-feira"],
    [2,"Terça-feira"],
    [3,"Quarta-feira"],
    [4,"Quinta-feira"],
    [5,"Sexta-feira"],
    [6,"Sábado"],
    [0,"Domingo"]
  ];

  return `
    <div class="blocked-layout">
      <section class="panel-card">
        <div class="panel-title">
          <div>
            <h3>Novo bloqueio recorrente</h3>
            <span>Reserve o mesmo dia e horário por um período</span>
          </div>
        </div>

        <div class="owner-settings-grid">
          <label>Começar a partir de
            <input id="blockStartDate" type="date" min="${today}" value="${today}">
          </label>

          <label>Dia da semana
            <select id="blockWeekday">
              ${weekdays.map(([value,label]) => `<option value="${value}">${label}</option>`).join("")}
            </select>
          </label>

          <label>Horário
            <select id="blockTime">
              ${getTimesForWeekday(1).map(t => `<option value="${t}">${t}</option>`).join("")}
            </select>
          </label>

          <label>Frequência
            <select id="blockFrequency">
              <option value="1">Toda semana</option>
              <option value="2">Semana sim, semana não</option>
            </select>
          </label>

          <label>Manter bloqueado por
            <select id="blockDuration">
              <option value="30">30 dias</option>
              <option value="90">90 dias</option>
              <option value="120">120 dias</option>
              <option value="365">1 ano</option>
            </select>
          </label>

          <label>Cliente fixo
            <input id="blockClient" placeholder="Ex.: João Silva">
          </label>

          <label>Telefone
            <input id="blockPhone" placeholder="(00) 99999-9999">
          </label>

          <label style="grid-column:1/-1">Observação
            <textarea id="blockNotes" rows="3" placeholder="Ex.: cliente semanal, corte + barba..."></textarea>
          </label>
        </div>

        <button class="btn btn-light" style="margin-top:18px" onclick="window.createBlockedSlot()">
          Criar série de bloqueios
        </button>
      </section>

      <section class="panel-card">
        <div class="panel-title">
          <div>
            <h3>Horários reservados</h3>
            <span>${future.length} bloqueios futuros</span>
          </div>
        </div>

        <div class="appointment-list">
          ${future.length ? future.map(b => `
            <div class="appointment-item">
              <div class="time-chip">${String(b.block_time).slice(0,5)}</div>

              <div>
                <strong>${escapeHtml(b.reserved_for)}</strong>
                <p>
                  ${fmtDate(b.block_date)}
                  ${b.client_phone ? ` • ${escapeHtml(b.client_phone)}` : ""}
                  ${b.recurrence_days ? ` • ${b.recurrence_frequency_weeks === 2 ? "semana sim, semana não" : "toda semana"} • ${b.recurrence_days === 365 ? "1 ano" : b.recurrence_days + " dias"}` : ""}
                  ${b.notes ? ` • ${escapeHtml(b.notes)}` : ""}
                </p>
              </div>

              <span class="status">Reservado</span>

              <div class="service-actions">
                <button class="mini-btn" onclick="window.deleteBlockedSlot('${b.id}')">Liberar este</button>
                ${b.group_id ? `<button class="mini-btn" onclick="window.deleteBlockedSeries('${b.group_id}')">Liberar série</button>` : ""}
              </div>
            </div>
          `).join("") : empty("Nenhum horário bloqueado","As séries reservadas para clientes fixos aparecerão aqui.")}
        </div>
      </section>
    </div>
  `;
}

async function bootSession() {
  if (!CONFIGURED) {
    showConfigWarning();
    return;
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    state.user = session.user;
    await Promise.all([loadProfile(), loadServices(), loadBusinessSettings()]);
    await loadAppointments();
    if (state.profile?.role === "owner") await Promise.all([loadOwnerLogs(), loadOwnerStats(), loadBlockedSlots()]);
    enterDashboard();
  } else {
    await Promise.all([loadServices(), loadBusinessSettings()]);
  }

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_OUT") {
      state.user = null;
      state.profile = null;
      state.appointments = [];
      exitDashboard();
    }
  });
}

function normalizePhoneBR(value) {
  const digits = String(value || "").replace(/\D/g, "");

  if (!digits) return "";

  if (digits.startsWith("55") && digits.length >= 12) {
    return `+${digits}`;
  }

  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`;
  }

  if (digits.length >= 12) {
    return `+${digits}`;
  }

  return "";
}

function isEmail(value) {
  return String(value || "").includes("@");
}

function internalEmailFromPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return `cliente.${digits}@brunobarbearia.local`;
}

async function login(identifier, password) {
  const value = String(identifier || "").trim();

  let email;

  if (isEmail(value)) {
    email = value.toLowerCase();
  } else {
    const phone = normalizePhoneBR(value);

    if (!phone) {
      return showToast("Digite um telefone válido com DDD.", true);
    }

    email = internalEmailFromPhone(phone);
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    console.error(error);
    return showToast("Telefone/e-mail ou senha incorretos.", true);
  }

  state.user = data.user;

  await Promise.all([
    loadProfile(),
    loadServices(),
    loadBusinessSettings()
  ]);

  await loadAppointments();

  if (state.profile?.role === "owner") {
    await Promise.all([
      loadOwnerLogs(),
      loadOwnerStats(),
      loadBlockedSlots()
    ]);
  }

  closeModal("authModal");
  enterDashboard();
}

async function register(name, email, phone, password) {
  const cleanName = String(name || "").trim();
  const cleanEmail = String(email || "").trim().toLowerCase();
  const normalizedPhone = normalizePhoneBR(phone);

  if (!cleanName) {
    return showToast("Digite seu nome.", true);
  }

  if (!normalizedPhone) {
    return showToast("Digite um telefone válido com DDD.", true);
  }

  if (!password || password.length < 6) {
    return showToast("A senha precisa ter pelo menos 6 caracteres.", true);
  }

  const authEmail = cleanEmail || internalEmailFromPhone(normalizedPhone);

  const { data, error } = await supabase.auth.signUp({
    email: authEmail,
    password,
    options: {
      data: {
        name: cleanName,
        phone: normalizedPhone,
        public_email: cleanEmail || null,
        uses_internal_email: !cleanEmail
      }
    }
  });

  if (error) {
    console.error(error);

    const message = (error.message || "").toLowerCase();

    if (
      message.includes("already registered") ||
      message.includes("already been registered") ||
      message.includes("user already registered")
    ) {
      return showToast("Esse telefone ou e-mail já possui uma conta.", true);
    }

    return showToast(error.message || "Não foi possível criar a conta.", true);
  }

  if (!data.session) {
    return showToast(
      "Conta criada, mas o Supabase está exigindo confirmação de e-mail. Desative Confirm email.",
      true
    );
  }

  state.user = data.user;

  await Promise.all([
    loadProfile(),
    loadServices(),
    loadBusinessSettings()
  ]);

  await loadAppointments();

  closeModal("authModal");
  enterDashboard();
  showToast("Conta criada com sucesso.");
}

async function logout() {
  await supabase.auth.signOut();
  exitDashboard();
}

function enterDashboard() {
  if (!state.profile) return;
  $("#publicSite").classList.add("hidden");
  $("#topbar").classList.add("hidden");
  $("#footer").classList.add("hidden");
  $("#dashboard").classList.remove("hidden");
  $("#sideName").textContent = state.profile.name || state.user.email;
  $("#sideRole").textContent = state.profile.role === "owner" ? "Proprietário" : "Cliente";
  $("#sideAvatar").textContent = (state.profile.name || "U")[0].toUpperCase();
  state.dashView = "overview";
  renderDashboardNav();
  renderDashboard();
  window.scrollTo(0,0);
}

function exitDashboard() {
  $("#dashboard").classList.add("hidden");
  $("#publicSite").classList.remove("hidden");
  $("#topbar").classList.remove("hidden");
  $("#footer").classList.remove("hidden");
  window.scrollTo({top:0, behavior:"smooth"});
}


async function loadOwnerAvailability(date) {
  if (!CONFIGURED || state.profile?.role !== "owner") return [];

  const { data, error } = await supabase
    .rpc("get_booked_times", { p_date: date });

  if (error) {
    console.error(error);
    showToast("Não foi possível consultar os horários.", true);
    return [];
  }

  return (data || []).map(item =>
    String(item.appointment_time).slice(0, 5)
  );
}

async function renderOwnerAvailability(date) {
  const container = $("#availabilityResults");
  if (!container) return;

  container.innerHTML = `<div class="loading-card">Consultando horários...</div>`;

  const busyTimes = new Set(await loadOwnerAvailability(date));

  const dayTimes = getTimesForDate(date);

  if (!dayTimes.length) {
    container.innerHTML = `<section class="panel-card"><div class="empty-state"><strong>Barbearia fechada</strong>Não há horários disponíveis neste dia.</div></section>`;
    return;
  }

  const freeCount = dayTimes.filter(time => !busyTimes.has(time)).length;
  const busyCount = dayTimes.length - freeCount;

  container.innerHTML = `
    <div class="dash-grid" style="margin-bottom:18px">
      ${metric("Horários livres", freeCount, "Disponíveis para agendamento")}
      ${metric("Ocupados / bloqueados", busyCount, "Indisponíveis")}
      ${metric("Total do dia", dayTimes.length, "Horários configurados")}
    </div>

    <section class="panel-card">
      <div class="panel-title">
        <div>
          <h3>Disponibilidade do dia</h3>
          <span>${fmtDate(date)}</span>
        </div>
      </div>

      <div class="availability-grid">
        ${dayTimes.map(time => {
          const busy = busyTimes.has(time);

          return `
            <div class="availability-slot ${busy ? "busy" : "free"}">
              <strong>${time}</strong>
              <span>${busy ? "Ocupado" : "Livre"}</span>
            </div>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderAvailabilityView() {
  const today = new Date().toISOString().slice(0,10);

  $("#dashTitle").textContent = "Horários disponíveis";

  $("#dashboardContent").innerHTML = `
    <section class="panel-card" style="margin-bottom:18px">
      <div class="panel-title">
        <div>
          <h3>Consultar disponibilidade</h3>
          <span>Escolha uma data para ver os horários livres</span>
        </div>
      </div>

      <div class="owner-settings-grid">
        <label>Data
          <input
            type="date"
            id="availabilityDate"
            min="${today}"
            value="${today}"
          >
        </label>
      </div>
    </section>

    <div id="availabilityResults"></div>
  `;

  const input = $("#availabilityDate");

  input.onchange = () => {
    renderOwnerAvailability(input.value);
  };

  renderOwnerAvailability(today);
}



async function renderManualBookingTimes() {
  const date = $("#manualBookingDate")?.value;
  const container = $("#manualTimeGrid");

  if (!date || !container) return;

  state.manualSelectedTime = null;

  const dayTimes = getTimesForDate(date);

  if (!dayTimes.length) {
    container.innerHTML = `
      <div class="loading-card" style="grid-column:1/-1">
        Barbearia fechada neste dia.
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="loading-card" style="grid-column:1/-1">
      Consultando horários...
    </div>`;

  // 1) Agendamentos já confirmados/concluídos
  const { data: appointmentsData, error: appointmentsError } = await supabase
    .from("appointments")
    .select("appointment_time,status")
    .eq("appointment_date", date)
    .in("status", ["confirmed", "completed"]);

  if (appointmentsError) {
    console.error("Erro ao consultar agendamentos:", appointmentsError);
    container.innerHTML = `
      <div class="loading-card" style="grid-column:1/-1">
        Não foi possível consultar os agendamentos.
      </div>`;
    return;
  }

  // 2) Horários bloqueados pelo proprietário, inclusive recorrentes
  const { data: blockedData, error: blockedError } = await supabase
    .from("blocked_slots")
    .select("block_time,reserved_for,notes")
    .eq("block_date", date);

  if (blockedError) {
    console.error("Erro ao consultar bloqueios:", blockedError);
    container.innerHTML = `
      <div class="loading-card" style="grid-column:1/-1">
        Não foi possível consultar os horários bloqueados.
      </div>`;
    return;
  }

  const busyAppointments = new Set(
    (appointmentsData || []).map(item =>
      String(item.appointment_time).slice(0, 5)
    )
  );

  const blockedTimes = new Set(
    (blockedData || []).map(item =>
      String(item.block_time).slice(0, 5)
    )
  );

  const blockedInfo = new Map(
    (blockedData || []).map(item => [
      String(item.block_time).slice(0, 5),
      item
    ])
  );

  container.innerHTML = dayTimes.map(time => {
    const booked = busyAppointments.has(time);
    const blocked = blockedTimes.has(time);

    let label = time;
    let extraClass = "";

    if (booked) {
      label = "Ocupado";
      extraClass = "busy";
    } else if (blocked) {
      label = "Bloqueado";
      extraClass = "blocked";
    }

    const block = blockedInfo.get(time);
    const title = blocked
      ? `Bloqueado${block?.reserved_for ? ` para ${block.reserved_for}` : ""}`
      : "";

    return `
      <button
        type="button"
        class="time-btn ${extraClass}"
        ${(booked || blocked) ? "disabled" : ""}
        data-manual-time="${time}"
        title="${escapeAttr(title)}"
      >
        ${booked || blocked ? `${time} • ${label}` : time}
      </button>
    `;
  }).join("");

  $$("#manualTimeGrid .time-btn:not([disabled])").forEach(btn => {
    btn.onclick = () => {
      state.manualSelectedTime = btn.dataset.manualTime;

      $$("#manualTimeGrid .time-btn").forEach(item =>
        item.classList.toggle(
          "selected",
          item.dataset.manualTime === state.manualSelectedTime
        )
      );

      updateManualBookingSummary();
    };
  });

  updateManualBookingSummary();
}

function updateManualBookingSummary() {
  const service = serviceById($("#manualService")?.value);
  const summary = $("#manualBookingSummary");

  if (!summary) return;

  summary.innerHTML = `
    <span>
      ${service ? escapeHtml(service.name) : "Serviço"}
      ${state.manualSelectedTime ? ` • ${state.manualSelectedTime}` : ""}
    </span>
    <strong>${service ? money(service.price) : ""}</strong>
  `;
}

async function createManualBooking() {
  if (state.profile?.role !== "owner") return;

  const clientName = $("#manualClientName")?.value.trim();
  const clientPhone = $("#manualClientPhone")?.value.trim() || null;
  const serviceId = Number($("#manualService")?.value);
  const date = $("#manualBookingDate")?.value;
  const time = state.manualSelectedTime;
  const notes = $("#manualBookingNotes")?.value.trim() || null;

  if (!clientName) {
    return showToast("Digite o nome da pessoa.", true);
  }

  if (!serviceId || !date || !time) {
    return showToast("Escolha serviço, data e horário.", true);
  }

  const { data, error } = await supabase.rpc(
    "owner_create_manual_appointment",
    {
      p_client_name: clientName,
      p_client_phone: clientPhone,
      p_service_id: serviceId,
      p_date: date,
      p_time: time,
      p_notes: notes
    }
  );

  if (error) {
    console.error(error);

    if (error.code === "23505") {
      return showToast("Esse horário acabou de ser ocupado.", true);
    }

    return showToast(
      error.message || "Não foi possível marcar o horário.",
      true
    );
  }

  state.manualSelectedTime = null;

  await Promise.all([
    loadAppointments(),
    loadOwnerLogs(),
    loadOwnerStats()
  ]);

  showToast("Horário marcado pelo proprietário.");
  renderManualBookingView();
}

function renderManualBookingView() {
  const today = new Date().toISOString().slice(0,10);
  const services = state.services.filter(s => s.active);

  $("#dashTitle").textContent = "Marcar horário";

  $("#dashboardContent").innerHTML = `
    <div class="panel-grid">
      <section class="panel-card">
        <div class="panel-title">
          <div>
            <h3>Agendamento pelo proprietário</h3>
            <span>Para clientes sem celular, conta ou acesso ao site</span>
          </div>
        </div>

        <div class="owner-settings-grid">
          <label>Nome da pessoa
            <input
              id="manualClientName"
              placeholder="Ex.: José da Silva"
            >
          </label>

          <label>Telefone <span style="font-weight:400;color:#666">(opcional)</span>
            <input
              id="manualClientPhone"
              placeholder="(00) 99999-9999"
            >
          </label>

          <label>Serviço
            <select id="manualService">
              ${services.map(s => `
                <option value="${s.id}">
                  ${escapeHtml(s.name)} — ${money(s.price)}
                </option>
              `).join("")}
            </select>
          </label>

          <label>Data
            <input
              type="date"
              id="manualBookingDate"
              min="${today}"
              value="${today}"
            >
          </label>

          <label style="grid-column:1/-1">Observação <span style="font-weight:400;color:#666">(opcional)</span>
            <textarea
              id="manualBookingNotes"
              rows="3"
              placeholder="Ex.: cliente passou pessoalmente na barbearia"
            ></textarea>
          </label>
        </div>

        <div style="margin-top:20px">
          <label>Horário
            <div class="time-grid" id="manualTimeGrid"></div>
          </label>
        </div>

        <div
          class="booking-summary"
          id="manualBookingSummary"
          style="margin-top:18px"
        ></div>

        <button
          class="btn btn-light btn-full"
          style="margin-top:16px"
          onclick="window.createManualBooking()"
        >
          Confirmar horário
        </button>
      </section>

      <section class="panel-card">
        <div class="panel-title">
          <div>
            <h3>Como funciona</h3>
            <span>Agendamento direto na agenda</span>
          </div>
        </div>

        <div class="feature-list">
          <div>
            <span>01</span>
            <p><strong>Sem conta</strong><br>A pessoa não precisa criar login.</p>
          </div>
          <div>
            <span>02</span>
            <p><strong>Telefone opcional</strong><br>Pode marcar até para quem não possui celular.</p>
          </div>
          <div>
            <span>03</span>
            <p><strong>Horário fica ocupado</strong><br>Os clientes do site não conseguem marcar no mesmo horário.</p>
          </div>
        </div>
      </section>
    </div>
  `;

  const dateInput = $("#manualBookingDate");
  const serviceInput = $("#manualService");

  dateInput.onchange = renderManualBookingTimes;
  serviceInput.onchange = updateManualBookingSummary;

  renderManualBookingTimes();
  updateManualBookingSummary();
}


function renderDashboardNav() {
  if (!state.profile) return;
  const owner = state.profile.role === "owner";
  const items = owner
    ? [["overview","Visão geral"],["agenda","Agenda"],["manual","Marcar horário"],["availability","Horários disponíveis"],["blocked","Horários bloqueados"],["services","Serviços"],["clients","Clientes"],["business","Barbearia"],["logs","Logs"],["profile","Meu perfil"]]
    : [["overview","Visão geral"],["appointments","Meus horários"],["new","Novo agendamento"],["profile","Meu perfil"]];
  $("#dashboardNav").innerHTML = items.map(([id,label]) =>
    `<button class="${state.dashView===id?"active":""}" data-view="${id}">${label}</button>`
  ).join("");
  $$("#dashboardNav button").forEach(btn => btn.onclick = async () => {
    state.dashView = btn.dataset.view;
    if (["overview","agenda","appointments","clients"].includes(state.dashView)) await loadAppointments();
    if (state.profile?.role === "owner" && state.dashView === "agenda") await loadBlockedSlots();
    if (state.profile?.role === "owner" && state.dashView === "overview") await loadOwnerStats();
    if (state.profile?.role === "owner" && state.dashView === "logs") await loadOwnerLogs();
    if (state.profile?.role === "owner" && state.dashView === "blocked") await loadBlockedSlots();
    if (state.profile?.role === "owner" && state.dashView === "business") await loadBusinessSettings();
    renderDashboardNav();
    renderDashboard();
    $("#sidebar").classList.remove("open");
  });
}

function metric(label, value, small="") {
  return `<div class="metric-card"><span>${label}</span><strong>${value}</strong>${small?`<small>${small}</small>`:""}</div>`;
}

function appointmentItem(a, owner=false) {
  const service = a.services || serviceById(a.service_id);
  const clientName = a.profiles?.name || a.manual_client_name || "Cliente";
  const status = STATUS_LABELS[a.status] || a.status;
  return `<div class="appointment-item">
    <div class="time-chip">${String(a.appointment_time).slice(0,5)}</div>
    <div>
      <strong>${escapeHtml(owner ? clientName : (service?.name || "Serviço"))}</strong>
      <p>${owner ? escapeHtml(service?.name || "Serviço") : fmtDate(a.appointment_date)} • ${service?.duration_minutes || "—"} min</p>
    </div>
    <span class="status">${status}</span>
    ${owner
      ? `<button class="icon-action" onclick="window.ownerStatusMenu('${a.id}')">Status</button>`
      : (a.status === "confirmed"
          ? `<button class="icon-action" onclick="window.cancelBooking('${a.id}')">×</button>`
          : `<span></span>`)}
  </div>`;
}

function renderDashboard() {
  if (!state.profile) return;
  const owner = state.profile.role === "owner";
  $("#dashEyebrow").textContent = owner ? "PAINEL DO PROPRIETÁRIO" : "PAINEL DO CLIENTE";
  $("#headerDate").textContent = new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"2-digit",month:"long"});
  owner ? renderOwner() : renderClient();
}

function futureAppointments(list) {
  const today = new Date().toISOString().slice(0,10);
  return list.filter(a => a.appointment_date >= today && a.status === "confirmed");
}


function agendaLocalISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function agendaSelectedDateObj() {
  const value = state.agendaSelectedDate || new Date().toISOString().slice(0,10);
  return new Date(`${value}T12:00:00`);
}

function setAgendaDate(date) {
  state.agendaSelectedDate = date;
  renderDashboard();
}

function changeAgendaDay(amount) {
  const d = agendaSelectedDateObj();
  d.setDate(d.getDate() + Number(amount));
  state.agendaSelectedDate = agendaLocalISO(d);
  renderDashboard();
}

function changeAgendaMonth(amount) {
  const current = agendaSelectedDateObj();
  const target = new Date(
    current.getFullYear(),
    current.getMonth() + Number(amount),
    1,
    12, 0, 0
  );

  state.agendaSelectedDate = agendaLocalISO(target);
  renderDashboard();
}

function agendaToday() {
  state.agendaSelectedDate = agendaLocalISO(new Date());
  renderDashboard();
}

function renderAgendaCalendar(allAppointments) {
  const selected = agendaSelectedDateObj();
  const year = selected.getFullYear();
  const month = selected.getMonth();

  const firstDay = new Date(year, month, 1, 12, 0, 0);
  const lastDay = new Date(year, month + 1, 0, 12, 0, 0);
  const daysInMonth = lastDay.getDate();
  const startWeekday = firstDay.getDay();

  const todayISO = agendaLocalISO(new Date());
  const monthLabel = selected.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric"
  });

  const countByDate = new Map();

  allAppointments.forEach(a => {
    if (!a.appointment_date || a.status === "cancelled") return;
    countByDate.set(
      a.appointment_date,
      (countByDate.get(a.appointment_date) || 0) + 1
    );
  });

  state.blockedSlots.forEach(b => {
    if (!b.block_date) return;
    countByDate.set(
      b.block_date,
      (countByDate.get(b.block_date) || 0) + 1
    );
  });

  const blanks = Array.from({ length: startWeekday }, () =>
    `<div class="agenda-calendar-empty"></div>`
  ).join("");

  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const date = new Date(year, month, day, 12, 0, 0);
    const iso = agendaLocalISO(date);
    const count = countByDate.get(iso) || 0;

    return `
      <button
        type="button"
        class="agenda-calendar-day
          ${iso === state.agendaSelectedDate ? "selected" : ""}
          ${iso === todayISO ? "today" : ""}
          ${count ? "has-events" : ""}"
        onclick="window.setAgendaDate('${iso}')"
      >
        <span>${day}</span>
        ${count ? `<small>${count}</small>` : ""}
      </button>
    `;
  }).join("");

  return `
    <section class="panel-card agenda-calendar-card">
      <div class="agenda-calendar-top">
        <button class="agenda-calendar-nav" onclick="window.changeAgendaMonth(-1)">←</button>

        <div>
          <strong>${escapeHtml(monthLabel)}</strong>
          <span>Escolha um dia para ver os horários</span>
        </div>

        <button class="agenda-calendar-nav" onclick="window.changeAgendaMonth(1)">→</button>
      </div>

      <div class="agenda-weekdays">
        <span>Dom</span>
        <span>Seg</span>
        <span>Ter</span>
        <span>Qua</span>
        <span>Qui</span>
        <span>Sex</span>
        <span>Sáb</span>
      </div>

      <div class="agenda-calendar-grid">
        ${blanks}
        ${days}
      </div>
    </section>
  `;
}


function renderOwner() {
  const all = state.appointments;
  const future = futureAppointments(all);
  const today = new Date().toISOString().slice(0,10);
  const todays = all.filter(a => a.appointment_date === today && a.status !== "cancelled");
  const revenue = all.filter(a => a.status === "completed").reduce((sum,a) => sum + Number(a.services?.price || 0), 0);
  const clientIds = new Set(all.map(a => a.client_id));
  const stats = state.ownerStats || {};

  if (state.dashView === "overview") {
    $("#dashTitle").textContent = "Visão geral";
    $("#dashboardContent").innerHTML = `
      <div class="dash-grid">
        ${metric("Agendamentos hoje", stats.appointments_today ?? todays.length, "Agenda do dia")}
        ${metric("Próximos horários", stats.future_appointments ?? future.length, "Confirmados")}
        ${metric("Clientes cadastrados", stats.total_clients ?? clientIds.size, "Contas de clientes")}
        ${metric("Receita concluída", money(stats.completed_revenue ?? revenue), "Atendimentos concluídos")}
      </div>
      <div class="panel-grid">
        <section class="panel-card">
          <div class="panel-title"><h3>Próximos atendimentos</h3><span>${future.length} agendados</span></div>
          <div class="appointment-list">${future.slice(0,8).map(a=>appointmentItem(a,true)).join("") || empty("Agenda livre","Nenhum atendimento próximo.")}</div>
        </section>
        <section class="panel-card">
          <div class="panel-title"><h3>Ações rápidas</h3></div>
          <div class="quick-actions">
            <button onclick="window.goDash('agenda')">Ver agenda completa →</button>
            <button onclick="window.goDash('manual')">+ Marcar para cliente →</button>
            <button onclick="window.goDash('availability')">Ver horários disponíveis →</button>
            <button onclick="window.goDash('blocked')">Bloquear horário →</button>
            <button onclick="window.goDash('services')">Gerenciar serviços →</button>
            <button onclick="window.goDash('clients')">Ver clientes →</button>
          </div>
        </section>
      </div>`;
  } else if (state.dashView === "agenda") {
    $("#dashTitle").textContent = "Agenda";

    const selectedDate = state.agendaSelectedDate || today;
    const selectedAppointments = all
      .filter(a => a.appointment_date === selectedDate)
      .sort((a,b) => String(a.appointment_time).localeCompare(String(b.appointment_time)));

    const selectedBlockedSlots = state.blockedSlots
      .filter(b => b.block_date === selectedDate)
      .sort((a,b) => String(a.block_time).localeCompare(String(b.block_time)));

    const selectedAgendaCount =
      selectedAppointments.length + selectedBlockedSlots.length;

    const selectedDateLabel = new Date(`${selectedDate}T12:00:00`)
      .toLocaleDateString("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric"
      });

    $("#dashboardContent").innerHTML = `
      <div class="agenda-layout">
        ${renderAgendaCalendar(all)}

        <section class="panel-card agenda-day-panel">
          <div class="agenda-day-toolbar">
            <div>
              <span class="eyebrow">DIA SELECIONADO</span>
              <h3>${escapeHtml(selectedDateLabel)}</h3>
              <small>
                ${selectedAgendaCount}
                ${selectedAgendaCount === 1 ? "registro" : "registros"}
              </small>
            </div>

            <div class="agenda-day-actions">
              <button class="mini-btn" onclick="window.changeAgendaDay(-1)">← Dia anterior</button>
              <button class="mini-btn" onclick="window.agendaToday()">Hoje</button>
              <button class="mini-btn" onclick="window.changeAgendaDay(1)">Próximo dia →</button>
            </div>
          </div>

          <div class="agenda-date-picker">
            <label>
              Ir direto para uma data
              <input
                type="date"
                value="${selectedDate}"
                onchange="window.setAgendaDate(this.value)"
              >
            </label>
          </div>

          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Horário</th>
                  <th>Cliente</th>
                  <th>Serviço</th>
                  <th>Valor</th>
                  <th>Status</th>
                  <th>Ação</th>
                </tr>
              </thead>

              <tbody>
                ${selectedAgendaCount
                  ? [
                      ...selectedAppointments.map(a => ({
                        type: "appointment",
                        time: String(a.appointment_time).slice(0,5),
                        html: `<tr>
                          <td><strong>${String(a.appointment_time).slice(0,5)}</strong></td>
                          <td>
                            ${escapeHtml(a.profiles?.name || a.manual_client_name || "Cliente")}
                            ${a.manual_client_name
                              ? `<br><small style="color:#666">
                                  Agendado pelo proprietário
                                  ${a.manual_client_phone ? ` • ${escapeHtml(a.manual_client_phone)}` : ""}
                                </small>`
                              : ""}
                          </td>
                          <td>${escapeHtml(a.services?.name || "Serviço")}</td>
                          <td>${money(a.services?.price)}</td>
                          <td>${STATUS_LABELS[a.status] || a.status}</td>
                          <td>
                            <button
                              class="mini-btn"
                              onclick="window.ownerStatusMenu('${a.id}')"
                            >
                              Alterar
                            </button>
                          </td>
                        </tr>`
                      })),
                      ...selectedBlockedSlots.map(b => ({
                        type: "blocked",
                        time: String(b.block_time).slice(0,5),
                        html: `<tr class="agenda-fixed-row">
                          <td><strong>${String(b.block_time).slice(0,5)}</strong></td>
                          <td>
                            ${escapeHtml(b.reserved_for || "Cliente fixo")}
                            ${b.client_phone
                              ? `<br><small style="color:#666">${escapeHtml(b.client_phone)}</small>`
                              : ""}
                          </td>
                          <td>
                            <strong>Horário fixo</strong>
                            ${b.notes
                              ? `<br><small style="color:#666">${escapeHtml(b.notes)}</small>`
                              : ""}
                          </td>
                          <td>—</td>
                          <td><span class="status">Bloqueado</span></td>
                          <td>
                            <button
                              class="mini-btn"
                              onclick="window.goDash('blocked')"
                            >
                              Ver bloqueio
                            </button>
                          </td>
                        </tr>`
                      }))
                    ]
                    .sort((a,b) => a.time.localeCompare(b.time))
                    .map(item => item.html)
                    .join("")
                  : `<tr>
                      <td colspan="6">
                        <div class="empty-state">
                          <strong>Nenhum agendamento ou horário fixo neste dia</strong>
                          Clique em outro dia no calendário ou use "Marcar horário".
                        </div>
                      </td>
                    </tr>`
                }
              </tbody>
            </table>
          </div>
        </section>
      </div>`;
  } else if (state.dashView === "manual") {
    renderManualBookingView();
  } else if (state.dashView === "availability") {
    renderAvailabilityView();
  } else if (state.dashView === "blocked") {
    $("#dashTitle").textContent = "Horários bloqueados";
    $("#dashboardContent").innerHTML = renderBlockedSlots();

    const blockWeekdaySelect = $("#blockWeekday");
    if (blockWeekdaySelect) {
      blockWeekdaySelect.onchange = refreshBlockTimes;
      refreshBlockTimes();
    }
  } else if (state.dashView === "services") {
    $("#dashTitle").textContent = "Serviços";
    $("#dashboardContent").innerHTML = `
      <section class="panel-card">
        <div class="panel-title"><h3>Serviços cadastrados</h3><button class="btn btn-light" onclick="window.newService()">+ Novo serviço</button></div>
        <div class="services-grid">${state.services.map(s=>serviceCard(s,true)).join("") || empty("Sem serviços","Cadastre o primeiro serviço.")}</div>
      </section>`;
  } else if (state.dashView === "clients") {
    $("#dashTitle").textContent = "Clientes";
    const clients = new Map();
    all.filter(a => a.client_id).forEach(a => {
      if (!clients.has(a.client_id)) clients.set(a.client_id, {
        id:a.client_id,
        name:a.profiles?.name || "Cliente",
        phone:a.profiles?.phone || "—",
        count:0
      });
      clients.get(a.client_id).count++;
    });
    $("#dashboardContent").innerHTML = `
      <section class="panel-card"><div class="panel-title"><h3>Clientes com agendamentos</h3><span>${clients.size}</span></div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Nome</th><th>Telefone</th><th>Agendamentos</th></tr></thead>
        <tbody>${[...clients.values()].map(c=>`<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.phone)}</td><td>${c.count}</td></tr>`).join("")}</tbody>
      </table></div></section>`;
  } else if (state.dashView === "business") {
    $("#dashTitle").textContent = "Dados da barbearia";
    const b = state.business || {};
    $("#dashboardContent").innerHTML = `
      <section class="panel-card">
        <div class="panel-title">
          <div><h3>Informações públicas</h3><span>Esses dados aparecem no site</span></div>
        </div>
        <div class="owner-settings-grid">
          <label>Nome da barbearia<input id="ownerShopName" value="${escapeAttr(b.shop_name || "Bruno Barbearia")}"></label>
          <label>Telefone<input id="ownerPhone" value="${escapeAttr(b.phone || "")}"></label>
          <label>WhatsApp<input id="ownerWhatsapp" value="${escapeAttr(b.whatsapp || "")}"></label>
          <label>Instagram<input id="ownerInstagram" value="${escapeAttr(b.instagram || "")}" placeholder="@brunobarbearia"></label>
          <label style="grid-column:1/-1">Endereço<input id="ownerAddress" value="${escapeAttr(b.address || "")}"></label>
          <label style="grid-column:1/-1">Horário de funcionamento<input id="ownerHours" value="${escapeAttr(b.opening_hours || "")}"></label>
        </div>
        <button class="btn btn-light" style="margin-top:18px" onclick="window.saveBusinessSettings()">Salvar alterações</button>
      </section>`;
  } else if (state.dashView === "logs") {
    $("#dashTitle").textContent = "Logs e atividades";
    $("#dashboardContent").innerHTML = `
      <section class="panel-card">
        <div class="panel-title">
          <div><h3>Histórico do sistema</h3><span>${state.logs.length} atividades carregadas</span></div>
          <div class="section-tools">
            <input id="logSearch" class="search-input" placeholder="Buscar cliente, ação..." oninput="window.filterOwnerLogs()">
            <select id="logType" class="select-small" onchange="window.filterOwnerLogs()">
              <option value="all">Todos</option>
              <option value="appointment">Agendamentos</option>
              <option value="service">Serviços</option>
              <option value="business_settings">Barbearia</option>
              <option value="blocked_slot">Horários bloqueados</option>
            </select>
          </div>
        </div>
        <div id="logsContainer">${renderLogList(state.logs)}</div>
      </section>`;
  } else {
    renderProfile();
  }
}

function renderClient() {
  const all = state.appointments.filter(a => a.client_id === state.user.id);
  const future = futureAppointments(all);

  if (state.dashView === "overview") {
    $("#dashTitle").textContent = `Olá, ${(state.profile.name || "").split(" ")[0] || "cliente"}`;
    $("#dashboardContent").innerHTML = `
      <div class="dash-grid">
        ${metric("Próximo horário", future[0] ? String(future[0].appointment_time).slice(0,5) : "—", future[0] ? fmtDate(future[0].appointment_date) : "Nenhum agendamento")}
        ${metric("Agendamentos", all.length, "Histórico total")}
        ${metric("Próximos", future.length, "Confirmados")}
        ${metric("Conta", "Ativa", "Cliente Bruno Barbearia")}
      </div>
      <div class="panel-grid">
        <section class="panel-card">
          <div class="panel-title"><h3>Próximos horários</h3><span>${future.length} agendados</span></div>
          <div class="appointment-list">${future.map(a=>appointmentItem(a)).join("") || empty("Nenhum horário marcado","Agende seu próximo corte em poucos cliques.")}</div>
        </section>
        <section class="panel-card">
          <div class="panel-title"><h3>Ações rápidas</h3></div>
          <div class="quick-actions">
            <button onclick="window.openBooking()">+ Novo agendamento</button>
            <button onclick="window.goDash('appointments')">Ver histórico →</button>
            <button onclick="window.goDash('profile')">Editar perfil →</button>
          </div>
        </section>
      </div>`;
  } else if (state.dashView === "appointments") {
    $("#dashTitle").textContent = "Meus horários";
    $("#dashboardContent").innerHTML = `<section class="panel-card">
      <div class="panel-title"><h3>Histórico de agendamentos</h3><span>${all.length} registros</span></div>
      <div class="appointment-list">${all.map(a=>appointmentItem(a)).join("") || empty("Sem histórico","Seu primeiro agendamento aparecerá aqui.")}</div>
    </section>`;
  } else if (state.dashView === "new") {
    $("#dashTitle").textContent = "Novo agendamento";
    $("#dashboardContent").innerHTML = `<section class="panel-card">
      <div class="panel-title"><h3>Escolha um serviço</h3></div>
      <div class="services-grid">${state.services.filter(s=>s.active).map(s=>serviceCard(s)).join("")}</div>
    </section>`;
  } else {
    renderProfile();
  }
}

function renderProfile() {
  $("#dashTitle").textContent = "Meu perfil";
  $("#dashboardContent").innerHTML = `<section class="panel-card">
    <div class="profile-card">
      <div class="big-avatar">${(state.profile.name || "U")[0].toUpperCase()}</div>
      <div>
        <div class="panel-title"><h3>Informações pessoais</h3></div>
        <div class="profile-fields">
          <label>Nome<input id="profileName" value="${escapeAttr(state.profile.name || "")}"></label>
          <label>E-mail<input value="${escapeAttr(state.user.user_metadata?.public_email || (state.profile.role === "owner" ? state.user.email : "Não informado"))}" disabled></label>
          <label>Telefone<input id="profilePhone" value="${escapeAttr(state.profile.phone || "")}"></label>
          <label>Tipo de conta<input value="${state.profile.role === "owner" ? "Proprietário" : "Cliente"}" disabled></label>
        </div>
        <button class="btn btn-light" style="margin-top:18px" onclick="window.saveProfile()">Salvar alterações</button>
      </div>
    </div>
  </section>`;
}

function empty(title, text) {
  return `<div class="empty-state"><strong>${title}</strong>${text}</div>`;
}

async function openBooking(serviceId) {
  if (!CONFIGURED) return showToast("Configure o Supabase primeiro.", true);
  if (!state.user || state.profile?.role !== "client") {
    showToast("Entre como cliente para agendar.");
    openModal("authModal");
    return;
  }
  if (serviceId) $("#bookingService").value = String(serviceId);
  state.selectedTime = null;
  if (!$("#bookingDate").value) $("#bookingDate").value = tomorrowISO();
  await renderTimes();
  updateBookingSummary();
  openModal("bookingModal");
}

async function renderTimes() {
  if (!CONFIGURED) return;
  const date = $("#bookingDate").value;
  if (!date) return;
  const { data, error } = await supabase
    .rpc("get_booked_times", { p_date: date });
  if (error) {
    console.error(error);
    showToast("Não foi possível verificar os horários.", true);
    return;
  }
  const busy = new Set((data || []).map(a => String(a.appointment_time).slice(0,5)));
  const dayTimes = getTimesForDate(date);

  if (!dayTimes.length) {
    $("#timeGrid").innerHTML = `<div class="loading-card" style="grid-column:1/-1">Fechado neste dia.</div>`;
    return;
  }

  $("#timeGrid").innerHTML = dayTimes.map(t => `
    <button type="button" class="time-btn ${state.selectedTime===t?"selected":""}" ${busy.has(t)?"disabled":""} data-time="${t}">
      ${busy.has(t) ? "Ocupado" : t}
    </button>`).join("");
  $$(".time-btn:not([disabled])").forEach(btn => btn.onclick = () => {
    state.selectedTime = btn.dataset.time;
    renderTimes();
    updateBookingSummary();
  });
}

function updateBookingSummary() {
  const s = serviceById($("#bookingService")?.value);
  if (!$("#bookingSummary")) return;
  $("#bookingSummary").innerHTML = `<span>${s ? escapeHtml(s.name) : "Serviço"}${state.selectedTime ? " • "+state.selectedTime : ""}</span><strong>${s ? money(s.price) : ""}</strong>`;
}

async function createBooking() {
  const serviceId = Number($("#bookingService").value);
  const date = $("#bookingDate").value;
  const time = state.selectedTime;
  if (!date || !time || !serviceId) return showToast("Preencha serviço, data e horário.", true);

  const { error } = await supabase.from("appointments").insert({
    client_id: state.user.id,
    service_id: serviceId,
    appointment_date: date,
    appointment_time: time,
    status: "confirmed"
  });

  if (error) {
    console.error(error);
    if (error.code === "23505") return showToast("Esse horário acabou de ser reservado. Escolha outro.", true);
    if ((error.message || "").toLowerCase().includes("reservado")) {
      return showToast("Esse horário foi bloqueado pelo proprietário. Escolha outro.", true);
    }
    return showToast("Não foi possível confirmar o agendamento.", true);
  }

  closeModal("bookingModal");
  state.selectedTime = null;
  await loadAppointments();
  state.dashView = "overview";
  renderDashboardNav();
  renderDashboard();
  showToast("Agendamento confirmado!");
}

async function cancelBooking(id) {
  if (!confirm("Deseja cancelar este agendamento?")) return;
  const { error } = await supabase.rpc("cancel_my_appointment", { p_appointment_id: id });
  if (error) return showToast(error.message || "Não foi possível cancelar.", true);
  await loadAppointments();
  renderDashboard();
  showToast("Agendamento cancelado.");
}

async function ownerStatusMenu(id) {
  const labels = "Digite o novo status:\nconfirmed = Confirmado\ncompleted = Concluído\ncancelled = Cancelado\nno_show = Não compareceu";
  const status = prompt(labels);
  if (!status) return;
  const allowed = ["confirmed","completed","cancelled","no_show"];
  if (!allowed.includes(status)) return showToast("Status inválido.", true);
  const { error } = await supabase.rpc("owner_set_appointment_status", {
    p_appointment_id: id,
    p_status: status
  });
  if (error) return showToast(error.message || "Não foi possível alterar.", true);
  await Promise.all([loadAppointments(), loadOwnerLogs(), loadOwnerStats()]);
  renderDashboard();
  showToast("Status atualizado.");
}

function newService() {
  $("#serviceId").value = "";
  $("#serviceName").value = "";
  $("#serviceDescription").value = "";
  $("#servicePrice").value = "";
  $("#serviceDuration").value = "45";
  $("#serviceModalTitle").textContent = "Novo serviço";
  openModal("serviceModal");
}

function editService(id) {
  const s = serviceById(id);
  if (!s) return;
  $("#serviceId").value = s.id;
  $("#serviceName").value = s.name;
  $("#serviceDescription").value = s.description || "";
  $("#servicePrice").value = s.price;
  $("#serviceDuration").value = s.duration_minutes;
  $("#serviceModalTitle").textContent = "Editar serviço";
  openModal("serviceModal");
}

async function saveService() {
  const id = $("#serviceId").value;
  const payload = {
    name: $("#serviceName").value.trim(),
    description: $("#serviceDescription").value.trim(),
    price: Number($("#servicePrice").value),
    duration_minutes: Number($("#serviceDuration").value)
  };
  const request = id
    ? supabase.from("services").update(payload).eq("id", Number(id))
    : supabase.from("services").insert({...payload, active:true});

  const { error } = await request;
  if (error) return showToast(error.message || "Não foi possível salvar o serviço.", true);
  closeModal("serviceModal");
  await loadServices();
  await loadOwnerLogs();
  renderDashboard();
  showToast("Serviço salvo.");
}

async function toggleService(id, active) {
  const { error } = await supabase.from("services").update({ active }).eq("id", id);
  if (error) return showToast("Não foi possível alterar o serviço.", true);
  await loadServices();
  await loadOwnerLogs();
  renderDashboard();
  showToast(active ? "Serviço ativado." : "Serviço desativado.");
}

async function saveProfile() {
  const name = $("#profileName").value.trim();
  const phone = $("#profilePhone").value.trim();
  const { error } = await supabase.from("profiles").update({ name, phone }).eq("id", state.user.id);
  if (error) return showToast("Não foi possível atualizar o perfil.", true);
  await loadProfile();
  $("#sideName").textContent = state.profile.name;
  $("#sideAvatar").textContent = state.profile.name[0].toUpperCase();
  renderProfile();
  showToast("Perfil atualizado.");
}

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate()+1);
  return d.toISOString().slice(0,10);
}

function escapeHtml(value="") {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function escapeAttr(value="") { return escapeHtml(value); }

function setupReveal() {
  const ob = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) e.target.classList.add("visible");
  }), {threshold:.08});
  $$(".reveal").forEach(el => ob.observe(el));
}

$$("[data-close]").forEach(btn => btn.onclick = () => closeModal(btn.dataset.close));
$$("[data-auth-tab]").forEach(btn => btn.onclick = () => authTab(btn.dataset.authTab));

$("#openLogin").onclick = () => CONFIGURED ? openModal("authModal") : showToast("Configure o Supabase no config.js.", true);
$("#openBooking").onclick = () => openBooking();
$("#heroBooking").onclick = () => openBooking();
$("#contactBooking").onclick = () => openBooking();
$("#logoutBtn").onclick = logout;
$("#mobileMenuBtn").onclick = () => $("#sidebar").classList.toggle("open");

$("#loginForm").onsubmit = e => {
  e.preventDefault();
  if (!CONFIGURED) return showToast("Configure o Supabase no config.js.", true);
  login($("#loginEmail").value.trim(), $("#loginPassword").value);
};

$("#registerForm").onsubmit = e => {
  e.preventDefault();
  if (!CONFIGURED) return showToast("Configure o Supabase no config.js.", true);
  register(
    $("#registerName").value.trim(),
    $("#registerEmail").value.trim(),
    $("#registerPhone").value.trim(),
    $("#registerPassword").value
  );
};

$("#bookingForm").onsubmit = e => {
  e.preventDefault();
  createBooking();
};

$("#serviceForm").onsubmit = e => {
  e.preventDefault();
  saveService();
};

$("#bookingDate").min = new Date().toISOString().slice(0,10);
$("#bookingDate").value = tomorrowISO();
$("#bookingDate").onchange = async () => {
  state.selectedTime = null;
  await renderTimes();
  updateBookingSummary();
};
$("#bookingService").onchange = updateBookingSummary;

window.openBooking = openBooking;
window.cancelBooking = cancelBooking;
window.ownerStatusMenu = ownerStatusMenu;

window.setAgendaDate = setAgendaDate;
window.changeAgendaDay = changeAgendaDay;
window.changeAgendaMonth = changeAgendaMonth;
window.agendaToday = agendaToday;
window.renderDashboard = renderDashboard;

window.newService = newService;
window.editService = editService;
window.toggleService = toggleService;
window.saveProfile = saveProfile;
window.saveBusinessSettings = saveBusinessSettings;
window.filterOwnerLogs = filterOwnerLogs;
window.createBlockedSlot = createBlockedSlot;
window.deleteBlockedSlot = deleteBlockedSlot;
window.deleteBlockedSeries = deleteBlockedSeries;
window.createManualBooking = createManualBooking;
window.goDash = async id => {
  state.dashView = id;
  if (["overview","agenda","appointments","clients"].includes(id)) await loadAppointments();
  if (state.profile?.role === "owner" && id === "overview") await loadOwnerStats();
  if (state.profile?.role === "owner" && id === "logs") await loadOwnerLogs();
  if (state.profile?.role === "owner" && id === "agenda") await loadBlockedSlots();
  if (state.profile?.role === "owner" && id === "blocked") await loadBlockedSlots();
  if (state.profile?.role === "owner" && id === "business") await loadBusinessSettings();
  renderDashboardNav();
  renderDashboard();
};


const agendaCalendarStyle = document.createElement("style");
agendaCalendarStyle.textContent = `
  .agenda-layout{
    display:grid;
    grid-template-columns:minmax(330px,.72fr) minmax(0,1.28fr);
    gap:18px;
    align-items:start;
  }

  .agenda-calendar-card{
    position:sticky;
    top:24px;
  }

  .agenda-calendar-top{
    display:grid;
    grid-template-columns:42px 1fr 42px;
    gap:12px;
    align-items:center;
    margin-bottom:22px;
  }

  .agenda-calendar-top>div{
    text-align:center;
    display:flex;
    flex-direction:column;
    gap:4px;
  }

  .agenda-calendar-top strong{
    font-family:"Playfair Display",serif;
    text-transform:capitalize;
    font-size:22px;
  }

  .agenda-calendar-top span{
    font-size:11px;
    color:#666;
  }

  .agenda-calendar-nav{
    height:42px;
    border:1px solid #282828;
    border-radius:12px;
    background:#121212;
    color:#fff;
    cursor:pointer;
    font-size:18px;
  }

  .agenda-calendar-nav:hover{
    background:#1b1b1b;
  }

  .agenda-weekdays,
  .agenda-calendar-grid{
    display:grid;
    grid-template-columns:repeat(7,1fr);
    gap:7px;
  }

  .agenda-weekdays{
    margin-bottom:8px;
  }

  .agenda-weekdays span{
    text-align:center;
    color:#565656;
    font-size:9px;
    font-weight:800;
    text-transform:uppercase;
    letter-spacing:.7px;
  }

  .agenda-calendar-empty{
    min-height:48px;
  }

  .agenda-calendar-day{
    min-height:48px;
    position:relative;
    border:1px solid #202020;
    border-radius:12px;
    background:#111;
    color:#aaa;
    cursor:pointer;
    display:flex;
    align-items:center;
    justify-content:center;
    transition:.18s ease;
  }

  .agenda-calendar-day:hover{
    background:#181818;
    color:#fff;
    border-color:#333;
    transform:translateY(-1px);
  }

  .agenda-calendar-day>span{
    font-size:12px;
    font-weight:700;
  }

  .agenda-calendar-day small{
    position:absolute;
    right:5px;
    top:5px;
    min-width:17px;
    height:17px;
    padding:0 4px;
    border-radius:20px;
    background:#292929;
    color:#ddd;
    display:grid;
    place-items:center;
    font-size:8px;
    font-weight:800;
  }

  .agenda-calendar-day.today{
    border-color:#555;
  }

  .agenda-calendar-day.today:after{
    content:"";
    position:absolute;
    bottom:5px;
    width:4px;
    height:4px;
    border-radius:50%;
    background:#fff;
  }

  .agenda-calendar-day.selected{
    background:linear-gradient(135deg,#fff,#bdbdbd);
    border-color:#fff;
    color:#070707;
    box-shadow:0 10px 30px rgba(255,255,255,.08);
  }

  .agenda-calendar-day.selected small{
    background:#111;
    color:#fff;
  }

  .agenda-day-panel{
    min-width:0;
  }

  .agenda-day-toolbar{
    display:flex;
    justify-content:space-between;
    gap:16px;
    align-items:flex-start;
    margin-bottom:16px;
  }

  .agenda-day-toolbar h3{
    font-family:"Playfair Display",serif;
    font-size:24px;
    text-transform:capitalize;
    margin-top:-7px;
  }

  .agenda-day-toolbar small{
    display:block;
    margin-top:6px;
    color:#666;
  }

  .agenda-day-actions{
    display:flex;
    gap:7px;
    flex-wrap:wrap;
    justify-content:flex-end;
  }

  .agenda-date-picker{
    max-width:260px;
    margin-bottom:18px;
  }

  @media(max-width:1100px){
    .agenda-layout{
      grid-template-columns:1fr;
    }

    .agenda-calendar-card{
      position:static;
    }
  }

  @media(max-width:600px){
    .agenda-day-toolbar{
      flex-direction:column;
    }

    .agenda-day-actions{
      justify-content:flex-start;
    }

    .agenda-calendar-day,
    .agenda-calendar-empty{
      min-height:42px;
    }

    .agenda-calendar-top strong{
      font-size:18px;
    }
  }
`;
document.head.appendChild(agendaCalendarStyle);


const agendaFixedStyle = document.createElement("style");
agendaFixedStyle.textContent = `
  .agenda-fixed-row{
    background:rgba(255,255,255,.025);
  }

  .agenda-fixed-row td{
    border-bottom-color:#292929;
  }

  .agenda-fixed-row td:first-child strong{
    position:relative;
  }

  .agenda-fixed-row td:first-child strong:after{
    content:"FIXO";
    display:inline-block;
    margin-left:8px;
    padding:3px 6px;
    border-radius:20px;
    border:1px solid #333;
    background:#161616;
    color:#888;
    font-size:8px;
    letter-spacing:1px;
    vertical-align:middle;
  }
`;
document.head.appendChild(agendaFixedStyle);

setupReveal();
bootSession();
