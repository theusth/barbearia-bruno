import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const CONFIGURED =
  SUPABASE_URL.startsWith("https://") &&
  !SUPABASE_URL.includes("COLE_") &&
  SUPABASE_ANON_KEY.length > 20 &&
  !SUPABASE_ANON_KEY.includes("COLE_");

const supabase = CONFIGURED ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const TIMES = ["09:00","10:00","11:00","12:00","14:00","15:00","16:00","17:00","18:00","19:00"];
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
  const query = supabase
    .from("appointments")
    .select(`
      id, client_id, service_id, appointment_date, appointment_time,
      status, notes, created_at,
      services ( id, name, price, duration_minutes ),
      profiles ( id, name, phone )
    `)
    .order("appointment_date", { ascending: true })
    .order("appointment_time", { ascending: true });

  const { data, error } = await query;
  if (error) {
    console.error(error);
    showToast("Não foi possível carregar os agendamentos.", true);
    return;
  }
  state.appointments = data || [];
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
    appointment_cancelled:"Agendamento cancelado",
    appointment_status_changed:"Status alterado",
    service_created:"Serviço criado",
    service_updated:"Serviço alterado",
    service_deleted:"Serviço removido",
    business_settings_updated:"Dados da barbearia alterados"
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
    if (state.profile?.role === "owner") await Promise.all([loadOwnerLogs(), loadOwnerStats()]);
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

async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return showToast("E-mail ou senha incorretos.", true);
  state.user = data.user;
  await Promise.all([loadProfile(), loadServices(), loadBusinessSettings()]);
  await loadAppointments();
  if (state.profile?.role === "owner") await Promise.all([loadOwnerLogs(), loadOwnerStats()]);
  closeModal("authModal");
  enterDashboard();
}

async function register(name, email, phone, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, phone } }
  });
  if (error) return showToast(error.message || "Não foi possível criar a conta.", true);

  if (!data.session) {
    closeModal("authModal");
    showToast("Conta criada. Confirme o e-mail antes de entrar.");
    authTab("login");
    return;
  }

  state.user = data.user;
  await Promise.all([loadProfile(), loadServices(), loadBusinessSettings()]);
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

function renderDashboardNav() {
  if (!state.profile) return;
  const owner = state.profile.role === "owner";
  const items = owner
    ? [["overview","Visão geral"],["agenda","Agenda"],["services","Serviços"],["clients","Clientes"],["business","Barbearia"],["logs","Logs"],["profile","Meu perfil"]]
    : [["overview","Visão geral"],["appointments","Meus horários"],["new","Novo agendamento"],["profile","Meu perfil"]];
  $("#dashboardNav").innerHTML = items.map(([id,label]) =>
    `<button class="${state.dashView===id?"active":""}" data-view="${id}">${label}</button>`
  ).join("");
  $$("#dashboardNav button").forEach(btn => btn.onclick = async () => {
    state.dashView = btn.dataset.view;
    if (["overview","agenda","appointments","clients"].includes(state.dashView)) await loadAppointments();
    if (state.profile?.role === "owner" && state.dashView === "overview") await loadOwnerStats();
    if (state.profile?.role === "owner" && state.dashView === "logs") await loadOwnerLogs();
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
  const clientName = a.profiles?.name || "Cliente";
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
            <button onclick="window.goDash('services')">Gerenciar serviços →</button>
            <button onclick="window.goDash('clients')">Ver clientes →</button>
          </div>
        </section>
      </div>`;
  } else if (state.dashView === "agenda") {
    $("#dashTitle").textContent = "Agenda";
    $("#dashboardContent").innerHTML = `
      <section class="panel-card">
        <div class="panel-title"><h3>Todos os agendamentos</h3><span>${all.length} registros</span></div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Data</th><th>Horário</th><th>Cliente</th><th>Serviço</th><th>Valor</th><th>Status</th><th>Ação</th></tr></thead>
          <tbody>${all.map(a=>`<tr>
            <td>${fmtDate(a.appointment_date)}</td>
            <td>${String(a.appointment_time).slice(0,5)}</td>
            <td>${escapeHtml(a.profiles?.name || "Cliente")}</td>
            <td>${escapeHtml(a.services?.name || "Serviço")}</td>
            <td>${money(a.services?.price)}</td>
            <td>${STATUS_LABELS[a.status] || a.status}</td>
            <td><button class="mini-btn" onclick="window.ownerStatusMenu('${a.id}')">Alterar</button></td>
          </tr>`).join("")}</tbody>
        </table></div>
      </section>`;
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
    all.forEach(a => {
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
          <label>E-mail<input value="${escapeAttr(state.user.email || "")}" disabled></label>
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
  $("#timeGrid").innerHTML = TIMES.map(t => `
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
window.newService = newService;
window.editService = editService;
window.toggleService = toggleService;
window.saveProfile = saveProfile;
window.saveBusinessSettings = saveBusinessSettings;
window.filterOwnerLogs = filterOwnerLogs;
window.goDash = async id => {
  state.dashView = id;
  if (["overview","agenda","appointments","clients"].includes(id)) await loadAppointments();
  if (state.profile?.role === "owner" && id === "overview") await loadOwnerStats();
  if (state.profile?.role === "owner" && id === "logs") await loadOwnerLogs();
  if (state.profile?.role === "owner" && id === "business") await loadBusinessSettings();
  renderDashboardNav();
  renderDashboard();
};

setupReveal();
bootSession();
