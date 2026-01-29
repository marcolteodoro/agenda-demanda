/* ================== SUPABASE ================== */
const SUPABASE_URL = "https://swxcryxuqumhbvvbfhvk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_JlSGIsbRrbFgyZb4ZnxNww_FomT7ukQ";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ========= Config / "tabelas" fixas ========= */
const TIPOS = [
  "Habitação","Investimento","Crédito","Consórcio","Seguridade",
  "Manutenção de Contas","Outros"
];
const STATUS = ["Não iniciada","Em progresso","Concluída","Com pendência"];
const CLASSIF = ["Regular","Urgente","Importante","Prioridade"];

/* ========= Estado do app ========= */
let tasks = [];
let selectedDate = isoToday();   // YYYY-MM-DD
let onlyOverdue = false;         // toggle "Atrasadas" (agora: mostra atrasadas de TODAS as datas)
let editingId = null;            // id em edição
let uiReady = false;             // garante que não duplica options
let realtimeChannel = null;
let showFuture = false; // 🔥 mostra tarefas com prazo >= selectedDate



/* ========= Helpers de data ========= */
function isoToday(){
  const d = new Date();
  d.setHours(0,0,0,0);
  return d.toISOString().slice(0,10);
}
function toDate(iso){ // ISO -> Date (00:00)
  const [y,m,dd] = iso.split("-").map(Number);
  const d = new Date(y, m-1, dd);
  d.setHours(0,0,0,0);
  return d;
}
function formatBR(iso){
  return toDate(iso).toLocaleDateString("pt-BR");
}
function startOfWeek(iso){ // segunda como início
  const d = toDate(iso);
  const day = d.getDay(); // 0 dom ... 6 sáb
  const diff = (day === 0) ? -6 : (1 - day);
  d.setDate(d.getDate() + diff);
  return d;
}
function addDays(dateObj, n){
  const d = new Date(dateObj);
  d.setDate(d.getDate() + n);
  d.setHours(0,0,0,0);
  return d;
}
function iso(dateObj){
  return dateObj.toISOString().slice(0,10);
}
function isOverdue(t){
  if (t.status === "Concluída") return false;
  return toDate(t.prazo) < toDate(isoToday());
}

/* ================== CLOUD ================== */
async function getUser(){
  const { data: { user } } = await db.auth.getUser();
  return user || null;
}

async function loadFromCloud() {
  const user = await getUser();
  if (!user) return [];

  const { data, error } = await db
    .from("demandas")
    .select("*")
    .eq("user_id", user.id);

  if (error) {
    alert("Erro ao carregar do Supabase: " + error.message);
    return [];
  }

  // dedup por ID (proteção extra)
  const map = new Map();
  for (const r of (data || [])) {
    map.set(r.id, {
      id: r.id,
      cliente: r.cliente,
      cpf: r.cpf,
      tipo: r.tipo,
      tarefa: r.tarefa,
      prazo: r.prazo,
      status: r.status,
      classificacao: r.classificacao,
      observacoes: r.observacoes || "",
      createdAt: r.created_at,
      updatedAt: r.updated_at
    });
  }
  return Array.from(map.values());
}

async function upsertToCloud(task) {
  const user = await getUser();
  if (!user) return;

  const row = {
    id: task.id,
    user_id: user.id,
    cliente: task.cliente,
    cpf: task.cpf,
    tipo: task.tipo,
    tarefa: task.tarefa,
    prazo: task.prazo,
    status: task.status,
    classificacao: task.classificacao,
    observacoes: task.observacoes || ""
  };

  // ✅ evita “insert duplicado” quando seu banco não está com PK perfeita
  const { error } = await db
    .from("demandas")
    .upsert(row, { onConflict: "id" });

  if (error) alert("Erro ao salvar: " + error.message);
}

async function deleteFromCloud(id) {
  const user = await getUser();
  if (!user) return;

  const { error } = await db
    .from("demandas")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) alert("Erro ao excluir: " + error.message);
}

async function startRealtime() {
  const user = await getUser();
  if (!user) return;

  if (realtimeChannel) {
    await db.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  realtimeChannel = db
    .channel(`demandas-sync-${user.id}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "demandas",
        filter: `user_id=eq.${user.id}`
      },
      async () => {
        tasks = await loadFromCloud();
        renderWeek();
        render();
      }
    )
    .subscribe();
}

/* ========= DOM refs ========= */
const weekLabel = document.getElementById("weekLabel");
const weekRow = document.getElementById("weekRow");
const tasksList = document.getElementById("tasksList");
const emptyState = document.getElementById("emptyState");
const overdueBadge = document.getElementById("overdueBadge");

const searchInput = document.getElementById("searchInput");
const typeFilter = document.getElementById("typeFilter");
const statusFilter = document.getElementById("statusFilter");
const classFilter = document.getElementById("classFilter");

const btnNew = document.getElementById("btnNew");
const btnToday = document.getElementById("btnToday");
const btnOverdue = document.getElementById("btnOverdue");
const btnExport = document.getElementById("btnExport");
const btnFuture = document.getElementById("btnFuture");


const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const btnClose = document.getElementById("btnClose");
const btnDelete = document.getElementById("btnDelete");
const taskForm = document.getElementById("taskForm");

const fCliente = document.getElementById("fCliente");
const fCpf = document.getElementById("fCpf");
const fTipo = document.getElementById("fTipo");
const fTarefa = document.getElementById("fTarefa");
const fPrazo = document.getElementById("fPrazo");
const fStatus = document.getElementById("fStatus");
const fClass = document.getElementById("fClass");
const fObs = document.getElementById("fObs");

const authModal = document.getElementById("authModal");
const aEmail = document.getElementById("aEmail");
const aPass = document.getElementById("aPass");
const btnLogin = document.getElementById("btnLogin");

/* ========= Auth modal ========= */
function openAuth(){ authModal.hidden = false; }
function closeAuth(){ authModal.hidden = true; }

/* ========= UI init (options) ========= */
function fillSelect(select, arr){
  select.innerHTML = arr.map(v => `<option value="${v}">${v}</option>`).join("");
}

function setupOptionsOnce(){
  if (uiReady) return;
  uiReady = true;

  // selects do formulário (sempre reseta)
  fillSelect(fTipo, TIPOS);
  fillSelect(fStatus, STATUS);
  fillSelect(fClass, CLASSIF);

  // filtros (sempre reseta e cria o "Todos" 1x)
  typeFilter.innerHTML = `<option value="">Tipo: Todos</option>` + TIPOS.map(v => `<option value="${v}">${v}</option>`).join("");
  statusFilter.innerHTML = `<option value="">Status: Todos</option>` + STATUS.map(v => `<option value="${v}">${v}</option>`).join("");
  classFilter.innerHTML = `<option value="">Classificação: Todas</option>` + CLASSIF.map(v => `<option value="${v}">${v}</option>`).join("");
}

/* ========= Semana: navegar para data futura ========= */
function shiftWeek(deltaDays){
  selectedDate = iso(addDays(toDate(selectedDate), deltaDays));
  renderWeek();
  render();
}

// clique no título da semana -> abre seletor de data (pular pra qualquer dia)
(function makeWeekLabelJumpAndNav(){
  if (!weekLabel) return;

  const jump = document.createElement("input");
  jump.type = "date";
  jump.style.position = "fixed";
  jump.style.left = "-9999px";
  jump.style.top = "-9999px";
  document.body.appendChild(jump);

  weekLabel.style.cursor = "pointer";
  weekLabel.title = "Clique no centro para escolher uma data • Esquerda = semana anterior • Direita = próxima semana";

  weekLabel.addEventListener("click", (e) => {
    const rect = weekLabel.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const third = rect.width / 3;

    // 1/3 esquerdo: volta semana
    if (x < third) {
      shiftWeek(-7);
      return;
    }

    // 1/3 direito: avança semana
    if (x > third * 2) {
      shiftWeek(7);
      return;
    }

    // centro: escolhe data
    jump.value = selectedDate;
    if (jump.showPicker) jump.showPicker();
    else jump.click();
  });

  jump.addEventListener("change", () => {
    if (!jump.value) return;
    selectedDate = jump.value;
    onlyOverdue = false;
    showFuture = false;
    btnOverdue.classList.remove("bottom__btn--active");
    renderWeek();
    render();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") shiftWeek(-7);
    if (e.key === "ArrowRight") shiftWeek(7);
  });
})();

  // atalhos: seta esquerda/direita troca semana
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") shiftWeek(-7);
    if (e.key === "ArrowRight") shiftWeek(7);
  });
})();

// Atalho: tecla F liga/desliga FUTURAS
document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "f") toggleFuture();
});


/* ========= Modal demanda ========= */
function openModal(){
  modal.hidden = false;
}
function closeModal(){
  modal.hidden = true;
  editingId = null;
}
function clearForm(){
  fCliente.value = "";
  fCpf.value = "";
  fTipo.value = TIPOS[0];
  fTarefa.value = "";
  fPrazo.value = selectedDate;
  fStatus.value = STATUS[0];
  fClass.value = CLASSIF[0];
  fObs.value = "";
}
function openNew(){
  editingId = null;
  modalTitle.textContent = "Nova demanda";
  btnDelete.hidden = true;
  clearForm();
  openModal();
}
function openEdit(id){
  const t = tasks.find(x => x.id === id);
  if (!t) return;

  editingId = id;
  modalTitle.textContent = "Editar demanda";
  btnDelete.hidden = false;

  fCliente.value = t.cliente;
  fCpf.value = t.cpf;
  fTipo.value = t.tipo;
  fTarefa.value = t.tarefa;
  fPrazo.value = t.prazo;
  fStatus.value = t.status;
  fClass.value = t.classificacao;
  fObs.value = t.observacoes || "";

  openModal();
}

/* ========= Render Semana ========= */
function renderWeek(){
  const start = startOfWeek(selectedDate);
  const end = addDays(start, 6);

  weekLabel.textContent =
    `${end.toLocaleDateString("pt-BR", { day:"2-digit", month:"short" })} (semana)` +
    ` | Início: ${start.toLocaleDateString("pt-BR")}`;

  weekRow.innerHTML = "";
  for(let i=0;i<7;i++){
    const d = addDays(start, i);
    const dIso = iso(d);
    const dow = d.toLocaleDateString("pt-BR", { weekday:"short" }).replace(".", "").toUpperCase();

    const el = document.createElement("div");
    el.className = "day" + (dIso === selectedDate ? " day--active" : "");
    el.innerHTML = `
      <div class="day__dow">${dow}</div>
      <div class="day__num">${dIso.slice(8,10)}</div>
    `;
    el.onclick = () => {
      selectedDate = dIso;
      renderWeek();
      render();
    };
    weekRow.appendChild(el);
  }
}

/* ========= Filtragem ========= */
function getFiltered(){
  const q = (searchInput.value || "").trim().toLowerCase();
  const t = typeFilter.value;
  const s = statusFilter.value;
  const c = classFilter.value;

  let list = tasks.slice();

  const hasSearch = q.length > 0;

  // ✅ comportamento novo:
  // - se Atrasadas ligado: mostra atrasadas de TODAS as datas
  // - se tem busca: busca em TODAS as datas
  // - senão: mostra só o dia selecionado
  if (onlyOverdue) {
  // atrasadas de todas as datas
  list = list.filter(isOverdue);

} else if (showFuture) {
  // 🔥 futuras a partir do dia selecionado
  list = list.filter(x => x.prazo >= selectedDate);

} else if (!hasSearch) {
  // padrão: só o dia selecionado
  list = list.filter(x => x.prazo === selectedDate);
}


  // filtros
  if (t) list = list.filter(x => x.tipo === t);
  if (s) list = list.filter(x => x.status === s);
  if (c) list = list.filter(x => x.classificacao === c);

  // busca
  if (hasSearch){
    list = list.filter(x =>
      (x.cliente || "").toLowerCase().includes(q) ||
      (x.tarefa || "").toLowerCase().includes(q) ||
      (x.cpf || "").toLowerCase().includes(q)
    );
  }

  // ordenação
  const rank = { "Prioridade": 3, "Importante": 2, "Urgente": 1, "Regular": 0 };
  list.sort((a,b) => {
    const r = (rank[b.classificacao] - rank[a.classificacao]);
    if (r !== 0) return r;
    if (a.prazo !== b.prazo) return a.prazo.localeCompare(b.prazo);
    return (a.tarefa || "").localeCompare(b.tarefa || "");
  });

  return list;
}

/* ========= Render Lista ========= */
function render(){
  const list = getFiltered();

  // badge atrasadas: agora mostra total geral (não só do dia)
  const overdueCount = tasks.filter(isOverdue).length;
  overdueBadge.hidden = overdueCount === 0;
  overdueBadge.textContent = `Atrasadas: ${overdueCount}`;

  tasksList.innerHTML = "";
  emptyState.hidden = list.length !== 0;

  list.forEach(t => {
    const el = document.createElement("div");
    el.className = "task" + (isOverdue(t) ? " task--overdue" : "");

    el.innerHTML = `
      <div class="task__top">
        <div>
          <p class="task__title">${escapeHtml(t.cliente)} — ${escapeHtml(t.tarefa)}</p>
          <div class="task__meta">
            CPF: ${escapeHtml(t.cpf)} • Tipo: ${escapeHtml(t.tipo)} • Prazo: ${formatBR(t.prazo)}
          </div>
          <div class="task__meta">
            Classificação: <b>${escapeHtml(t.classificacao)}</b>
            ${t.observacoes ? " • Obs: " + escapeHtml(t.observacoes) : ""}
          </div>
        </div>

        <div class="task__right">
          <div class="pill ${isOverdue(t) ? "pill--red" : "pill--blue"}">${escapeHtml(t.status)}</div>
          <button class="smallbtn smallbtn--blue" data-edit="${t.id}">Editar</button>
        </div>
      </div>

      <div class="task__actions">
        ${STATUS.map(st => `<button class="smallbtn" data-status="${st}" data-id="${t.id}">${st}</button>`).join("")}
      </div>
    `;

    tasksList.appendChild(el);
  });

  tasksList.querySelectorAll("[data-edit]").forEach(btn => {
    btn.onclick = () => openEdit(btn.getAttribute("data-edit"));
  });

  tasksList.querySelectorAll("[data-status]").forEach(btn => {
    btn.onclick = async () => {
      await quickStatus(btn.getAttribute("data-id"), btn.getAttribute("data-status"));
    };
  });
}

/* ========= Ações ========= */
async function quickStatus(id, status){
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  t.status = status;
  t.updatedAt = new Date().toISOString();
  await upsertToCloud(t);
  render();
}

async function removeTask(){
  if (!editingId) return;
  const id = editingId;

  // otimista
  tasks = tasks.filter(x => x.id !== id);
  closeModal();
  render();

  await deleteFromCloud(id);

  // garante consistência
  tasks = await loadFromCloud();
  renderWeek();
  render();
}

/* ========= Validação + Salvar ========= */
async function submitForm(e){
  e.preventDefault();

  const cliente = fCliente.value.trim();
  const cpf = fCpf.value.trim();
  const tipo = fTipo.value;
  const tarefa = fTarefa.value.trim();
  const prazo = fPrazo.value;
  const status = fStatus.value;
  const classificacao = fClass.value;
  const observacoes = fObs.value.trim();

  if (!cliente || !cpf || !tipo || !tarefa || !prazo || !status || !classificacao) {
    alert("Preencha todos os campos obrigatórios (*)");
    return;
  }

  const now = new Date().toISOString();
  let task;

  if (editingId){
    task = tasks.find(x => x.id === editingId);
    if (!task) return;

    task.cliente = cliente;
    task.cpf = cpf;
    task.tipo = tipo;
    task.tarefa = tarefa;
    task.prazo = prazo;
    task.status = status;
    task.classificacao = classificacao;
    task.observacoes = observacoes;
    task.updatedAt = now;
  } else {
    task = {
      id: crypto.randomUUID(),
      cliente,
      cpf,
      tipo,
      tarefa,
      prazo,
      status,
      classificacao,
      observacoes,
      createdAt: now,
      updatedAt: now
    };
    tasks.push(task);
  }

  await upsertToCloud(task);

  closeModal();

  // ✅ agora você consegue “ver” qualquer tarefa criada em data futura:
  selectedDate = prazo;
  onlyOverdue = false;
  btnOverdue.classList.remove("bottom__btn--active");

  renderWeek();
  render();
}

/* ========= CPF mask (000.000.000-00) ========= */
fCpf.addEventListener("input", () => {
  const digits = fCpf.value.replace(/\D/g, "").slice(0, 11);
  let out = digits;
  if (digits.length > 3) out = digits.slice(0,3) + "." + digits.slice(3);
  if (digits.length > 6) out = out.slice(0,7) + "." + digits.slice(6);
  if (digits.length > 9) out = out.slice(0,11) + "-" + digits.slice(9);
  fCpf.value = out;
});

/* ========= Exportar PDF ========= */
function exportPDF(){
  window.print();
}

/* ========= Escape HTML ========= */
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

/* ========= Eventos de UI ========= */
btnNew.onclick = openNew;
btnClose.onclick = closeModal;
modal.onclick = (e) => { if (e.target === modal) closeModal(); };

btnToday.onclick = () => {
  selectedDate = isoToday();
  onlyOverdue = false;
  btnOverdue.classList.remove("bottom__btn--active");
  renderWeek();
  render();
};

btnOverdue.onclick = () => {
  onlyOverdue = !onlyOverdue;
  btnOverdue.classList.toggle("bottom__btn--active", onlyOverdue);
  render();
};

btnExport.onclick = exportPDF;
btnDelete.onclick = async () => { await removeTask(); };

taskForm.onsubmit = async (e) => { await submitForm(e); };

[searchInput, typeFilter, statusFilter, classFilter].forEach(el => {
  el.addEventListener("input", render);
  el.addEventListener("change", render);
});

/* ========= Login ========= */
btnLogin.onclick = async () => {
  const email = aEmail.value.trim();
  const password = aPass.value.trim();

  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) return alert("Login falhou: " + error.message);

  closeAuth();

  tasks = await loadFromCloud();
  await startRealtime();
  renderWeek();
  render();
};

function toggleFuture(){
  showFuture = !showFuture;

  // se ligar Futuras, desliga Atrasadas (pra não confundir)
  if (showFuture) {
    onlyOverdue = false;
    btnOverdue.classList.remove("bottom__btn--active");
  }

  render();
}


/* ========= Start ========= */
async function init(){
  setupOptionsOnce();
  closeModal();

  const user = await getUser();
  if (!user) {
    openAuth();
    return;
  }

  closeAuth();
  tasks = await loadFromCloud();
  await startRealtime();

  renderWeek();
  render();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }
}

init();
