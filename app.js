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

/* ========= Estado ========= */
let tasks = [];
let selectedDate = isoToday();
let showFuture = true;      // ✅ padrão: mostrar a partir do dia selecionado
let showOverdueOnly = false;
let editingId = null;
let realtimeChannel = null;
let isSaving = false;

/* ========= Helpers de data ========= */
function isoToday(){
  const d = new Date();
  d.setHours(0,0,0,0);
  return d.toISOString().slice(0,10);
}
function toDate(iso){
  const [y,m,dd] = iso.split("-").map(Number);
  const d = new Date(y, m-1, dd);
  d.setHours(0,0,0,0);
  return d;
}
function iso(dateObj){
  return dateObj.toISOString().slice(0,10);
}
function addDays(dateObj, n){
  const d = new Date(dateObj);
  d.setDate(d.getDate() + n);
  d.setHours(0,0,0,0);
  return d;
}
function formatBR(isoStr){
  return toDate(isoStr).toLocaleDateString("pt-BR");
}
function startOfWeek(isoStr){
  const d = toDate(isoStr);
  const day = d.getDay(); // 0 dom ... 6 sáb
  const diff = (day === 0) ? -6 : (1 - day); // segunda
  d.setDate(d.getDate() + diff);
  return d;
}
function isOverdue(t){
  if (t.status === "Concluída") return false;
  return toDate(t.prazo) < toDate(isoToday());
}

/* ========= DOM refs ========= */
const weekLabel   = document.getElementById("weekLabel");
const weekRow     = document.getElementById("weekRow");
const tasksList   = document.getElementById("tasksList");
const emptyState  = document.getElementById("emptyState");
const overdueBadge= document.getElementById("overdueBadge");
const listTitle   = document.getElementById("listTitle");

const searchInput = document.getElementById("searchInput");
const typeFilter  = document.getElementById("typeFilter");
const statusFilter= document.getElementById("statusFilter");
const classFilter = document.getElementById("classFilter");

const btnNew     = document.getElementById("btnNew");
const btnToday   = document.getElementById("btnToday");
const btnFuture  = document.getElementById("btnFuture"); // ✅ importante: id tem que existir no HTML
const btnOverdue = document.getElementById("btnOverdue");
const btnExport  = document.getElementById("btnExport");

const btnPrevWeek = document.getElementById("btnPrevWeek");
const btnNextWeek = document.getElementById("btnNextWeek");

const modal      = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const btnClose   = document.getElementById("btnClose");
const btnDelete  = document.getElementById("btnDelete");
const taskForm   = document.getElementById("taskForm");

const fCliente = document.getElementById("fCliente");
const fCpf     = document.getElementById("fCpf");
const fTipo    = document.getElementById("fTipo");
const fTarefa  = document.getElementById("fTarefa");
const fPrazo   = document.getElementById("fPrazo");
const fStatus  = document.getElementById("fStatus");
const fClass   = document.getElementById("fClass");
const fObs     = document.getElementById("fObs");

const authModal = document.getElementById("authModal");
const aEmail    = document.getElementById("aEmail");
const aPass     = document.getElementById("aPass");
const btnLogin  = document.getElementById("btnLogin");

/* ========= UI helpers ========= */
function openModal(){ modal.hidden = false; }
function closeModal(){ modal.hidden = true; editingId = null; }

function openAuth(){ authModal.hidden = false; }
function closeAuth(){ authModal.hidden = true; }

function fillSelect(select, arr){
  select.innerHTML = arr.map(v => `<option value="${v}">${v}</option>`).join("");
}

function setupSelectsOnce(){
  // selects do formulário (modal)
  fillSelect(fTipo, TIPOS);
  fillSelect(fStatus, STATUS);
  fillSelect(fClass, CLASSIF);

  // filtros (limpa e recria, evita duplicar)
  typeFilter.innerHTML   = `<option value="">Tipo: Todos</option>`;
  statusFilter.innerHTML = `<option value="">Status: Todos</option>`;
  classFilter.innerHTML  = `<option value="">Classificação: Todas</option>`;

  TIPOS.forEach(v => typeFilter.insertAdjacentHTML("beforeend", `<option value="${v}">${v}</option>`));
  STATUS.forEach(v => statusFilter.insertAdjacentHTML("beforeend", `<option value="${v}">${v}</option>`));
  CLASSIF.forEach(v => classFilter.insertAdjacentHTML("beforeend", `<option value="${v}">${v}</option>`));
}

function setBottomActive(){
  btnFuture?.classList.toggle("bottom__btn--active", showFuture && !showOverdueOnly);
  btnOverdue?.classList.toggle("bottom__btn--active", showOverdueOnly);
}

/* ========= Supabase (cloud) ========= */
async function getUser(){
  const { data: { user } } = await db.auth.getUser();
  return user || null;
}

function dedupeById(list){
  const m = new Map();
  for (const t of list) m.set(t.id, t);
  return Array.from(m.values());
}

async function loadFromCloud(){
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

  const mapped = (data || []).map(r => ({
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
  }));

  return dedupeById(mapped);
}

async function upsertToCloud(task){
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

  // ✅ onConflict garante upsert de verdade por id
  const { error } = await db.from("demandas").upsert(row, { onConflict: "id" });
  if (error) throw error;
}

async function deleteFromCloud(id){
  const user = await getUser();
  if (!user) return;

  const { error } = await db
    .from("demandas")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw error;
}

async function startRealtime(){
  const user = await getUser();
  if (!user) return;

  if (realtimeChannel) {
    await db.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  realtimeChannel = db
    .channel("demandas-sync")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "demandas", filter: `user_id=eq.${user.id}` },
      async () => {
        // ✅ sempre “verdade” do banco
        tasks = await loadFromCloud();
        renderWeek();
        render();
      }
    )
    .subscribe();
}

/* ========= Semana ========= */
function shiftWeek(deltaDays){
  selectedDate = iso(addDays(toDate(selectedDate), deltaDays));
  renderWeek();
  render();
}

function renderWeek(){
  const start = startOfWeek(selectedDate);
  const end = addDays(start, 6);

  weekLabel.textContent =
    `${end.toLocaleDateString("pt-BR", { day:"2-digit", month:"short" })} (semana)` +
    ` | Início: ${start.toLocaleDateString("pt-BR")}`;

  weekRow.innerHTML = "";
  for (let i=0;i<7;i++){
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

/* ========= Filtro/Render ========= */
function getFiltered(){
  let list = tasks.slice();

  // modo atrasadas: ignora data e mostra tudo que está atrasado
  if (showOverdueOnly) {
    list = list.filter(isOverdue);
  } else {
    // ✅ padrão: mostrar a partir do dia selecionado
    if (showFuture) list = list.filter(x => x.prazo >= selectedDate);
    else list = list.filter(x => x.prazo === selectedDate);
  }

  // filtros de dropdown
  const t = typeFilter.value;
  const s = statusFilter.value;
  const c = classFilter.value;
  if (t) list = list.filter(x => x.tipo === t);
  if (s) list = list.filter(x => x.status === s);
  if (c) list = list.filter(x => x.classificacao === c);

  // busca
  const q = (searchInput.value || "").trim().toLowerCase();
  if (q){
    list = list.filter(x =>
      x.cliente.toLowerCase().includes(q) ||
      x.tarefa.toLowerCase().includes(q) ||
      x.cpf.toLowerCase().includes(q)
    );
  }

  // ordenação
  const rank = { "Prioridade": 3, "Importante": 2, "Urgente": 1, "Regular": 0 };
  list.sort((a,b) => {
    const byDate = a.prazo.localeCompare(b.prazo);
    if (byDate !== 0) return byDate;
    const byRank = (rank[b.classificacao] - rank[a.classificacao]);
    if (byRank !== 0) return byRank;
    return a.tarefa.localeCompare(b.tarefa);
  });

  return list;
}

function render(){
  setBottomActive();

  const list = getFiltered();

  // título
  if (showOverdueOnly) {
    listTitle.textContent = "Atrasadas";
  } else if (showFuture) {
    listTitle.textContent = `Tarefas a partir de ${formatBR(selectedDate)}`;
  } else {
    listTitle.textContent = "Tarefas do dia";
  }

  // badge
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
          <button class="smallbtn smallbtn--blue" data-edit="${t.id}" type="button">Editar</button>
        </div>
      </div>

      <div class="task__actions">
        ${STATUS.map(st => `
          <button
            class="smallbtn smallbtn--status ${t.status === st ? "is-active" : ""}"
            data-status="${st}"
            data-st="${st}"
            data-id="${t.id}"
            type="button"
          >${st}</button>
        `).join("")}
      </div>

    `;

    tasksList.appendChild(el);
  });

  tasksList.querySelectorAll("[data-edit]").forEach(btn => {
    btn.onclick = () => openEdit(btn.getAttribute("data-edit"));
  });
  tasksList.querySelectorAll("[data-status]").forEach(btn => {
    btn.onclick = () => quickStatus(btn.getAttribute("data-id"), btn.getAttribute("data-status"));
  });
}

/* ========= CRUD local + modal ========= */
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

async function quickStatus(id, status){
  const t = tasks.find(x => x.id === id);
  if (!t) return;

  t.status = status;
  t.updatedAt = new Date().toISOString();

  try{
    await upsertToCloud(t);
    // “verdade” do banco
    tasks = await loadFromCloud();
    renderWeek();
    render();
  }catch(err){
    alert("Erro ao atualizar status: " + err.message);
  }
}

async function removeTask(){
  if (!editingId) return;

  if (!confirm("Excluir esta demanda?")) return;

  try{
    await deleteFromCloud(editingId);
    tasks = await loadFromCloud();
    closeModal();
    renderWeek();
    render();
  }catch(err){
    alert("Erro ao excluir: " + err.message);
  }
}

/* ========= Salvar ========= */
async function submitForm(e){
  e.preventDefault();
  if (isSaving) return; // ✅ impede duplo clique
  isSaving = true;

  const submitBtn = taskForm.querySelector('button[type="submit"]');
  const oldLabel = submitBtn ? submitBtn.textContent : "";
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Salvando..."; }

  try{
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
    let taskToSave;

    if (editingId){
      const t = tasks.find(x => x.id === editingId);
      if (!t) return;

      t.cliente = cliente;
      t.cpf = cpf;
      t.tipo = tipo;
      t.tarefa = tarefa;
      t.prazo = prazo;
      t.status = status;
      t.classificacao = classificacao;
      t.observacoes = observacoes;
      t.updatedAt = now;

      taskToSave = t;
    } else {
      taskToSave = {
        id: crypto.randomUUID(),
        cliente, cpf, tipo, tarefa, prazo, status,
        classificacao,
        observacoes,
        createdAt: now,
        updatedAt: now
      };
    }

    await upsertToCloud(taskToSave);

    // ✅ evita duplicação: sempre recarrega do banco após salvar
    tasks = await loadFromCloud();

    closeModal();
    selectedDate = prazo;
    showFuture = true;       // ✅ após salvar, já mostra “a partir do dia”
    showOverdueOnly = false;

    renderWeek();
    render();
  }catch(err){
    alert("Erro ao salvar: " + err.message);
  }finally{
    isSaving = false;
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = oldLabel; }
  }
}

/* ========= CPF mask ========= */
fCpf.addEventListener("input", () => {
  const digits = fCpf.value.replace(/\D/g, "").slice(0, 11);
  let out = digits;
  if (digits.length > 3) out = digits.slice(0,3) + "." + digits.slice(3);
  if (digits.length > 6) out = out.slice(0,7) + "." + digits.slice(6);
  if (digits.length > 9) out = out.slice(0,11) + "-" + digits.slice(9);
  fCpf.value = out;
});

/* ========= Exportar PDF ========= */
function exportPDF(){ window.print(); }

/* ========= Escape HTML ========= */
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

/* ========= Eventos ========= */
btnNew.onclick = openNew;
btnClose.onclick = closeModal;
modal.onclick = (e) => { if (e.target === modal) closeModal(); };

btnToday.onclick = () => {
  selectedDate = isoToday();
  showOverdueOnly = false;
  showFuture = true;
  renderWeek();
  render();
};

btnFuture.onclick = () => {
  showOverdueOnly = false;
  showFuture = !showFuture;
  renderWeek();
  render();
};

btnOverdue.onclick = () => {
  showOverdueOnly = !showOverdueOnly;
  renderWeek();
  render();
};

btnExport.onclick = exportPDF;
btnDelete.onclick = removeTask;

taskForm.onsubmit = submitForm;

[searchInput, typeFilter, statusFilter, classFilter].forEach(el => {
  el.addEventListener("input", render);
  el.addEventListener("change", render);
});

btnPrevWeek?.addEventListener("click", () => shiftWeek(-7));
btnNextWeek?.addEventListener("click", () => shiftWeek(7));

// atalhos teclado
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") shiftWeek(-7);
  if (e.key === "ArrowRight") shiftWeek(7);
  if (e.key.toLowerCase() === "f") {
    showOverdueOnly = false;
    showFuture = !showFuture;
    renderWeek();
    render();
  }
});

/* ========= Login ========= */
btnLogin.addEventListener("click", async (e) => {
  e.preventDefault();

  const email = aEmail.value.trim();
  const password = aPass.value.trim();
  if (!email || !password) return alert("Informe email e senha.");

  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) return alert("Login falhou: " + error.message);

  await afterLogin();
});

async function afterLogin(){
  closeAuth();
  tasks = await loadFromCloud();
  await startRealtime();
  renderWeek();
  render();
}

/* ========= INIT ========= */
async function init(){
  closeModal();
  setupSelectsOnce();

  const user = await getUser();
  if (!user) {
    openAuth();
    return;
  }

  await afterLogin();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }
}

init();
