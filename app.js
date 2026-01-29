/* ========= Config / "tabelas" fixas ========= */
const TIPOS = [
  "Habitação","Investimento","Crédito","Consórcio","Seguridade",
  "Manutenção de Contas","Outros"
];
const STATUS = ["Não iniciada","Em progresso","Concluída","Com pendência"];
const CLASSIF = ["Regular","Urgente","Importante","Prioridade"];

const LS_KEY = "agenda_demandas_v1";

/* ========= Estado do app ========= */
let tasks = [];                 // lista completa
let selectedDate = isoToday();  // YYYY-MM-DD
let onlyOverdue = false;        // toggle do botão "Atrasadas"
let editingId = null;           // se estiver editando, guarda o id

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
  const d = toDate(iso);
  return d.toLocaleDateString("pt-BR");
}
function startOfWeek(iso){ // segunda como início
  const d = toDate(iso);
  const day = d.getDay(); // 0 dom ... 6 sáb
  const diff = (day === 0) ? -6 : (1 - day); // segunda
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

/* ========= Storage ========= */
function load(){
  const raw = localStorage.getItem(LS_KEY);
  tasks = raw ? JSON.parse(raw) : [];
}
function save(){
  localStorage.setItem(LS_KEY, JSON.stringify(tasks));
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

/* ========= UI init ========= */
function fillSelect(select, arr){
  select.innerHTML = arr.map(v => `<option value="${v}">${v}</option>`).join("");
}

function init(){
  load();

  // Preenche selects do formulário
  fillSelect(fTipo, TIPOS);
  fillSelect(fStatus, STATUS);
  fillSelect(fClass, CLASSIF);

  // Preenche filtros
  TIPOS.forEach(v => typeFilter.insertAdjacentHTML("beforeend", `<option value="${v}">${v}</option>`));
  STATUS.forEach(v => statusFilter.insertAdjacentHTML("beforeend", `<option value="${v}">${v}</option>`));
  CLASSIF.forEach(v => classFilter.insertAdjacentHTML("beforeend", `<option value="${v}">${v}</option>`));

  renderWeek();
  render();

  closeModal();

  // Service Worker (offline)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }
}

/* ========= Render Semana ========= */
function renderWeek(){
  const start = startOfWeek(selectedDate);
  const end = addDays(start, 6);

  weekLabel.textContent = `${end.toLocaleDateString("pt-BR", { day:"2-digit", month:"short" })} (semana)` +
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

  // Tarefas do dia selecionado
  list = list.filter(x => x.prazo === selectedDate);

  // Toggle atrasadas
  if (onlyOverdue) list = list.filter(isOverdue);

  // Filtros
  if (t) list = list.filter(x => x.tipo === t);
  if (s) list = list.filter(x => x.status === s);
  if (c) list = list.filter(x => x.classificacao === c);

  // Busca
  if (q){
    list = list.filter(x =>
      x.cliente.toLowerCase().includes(q) ||
      x.tarefa.toLowerCase().includes(q) ||
      x.cpf.toLowerCase().includes(q)
    );
  }

  // Ordenação por prazo (mesmo dia) e prioridade (simples: Prioridade > Importante > Urgente > Regular)
  const rank = { "Prioridade": 3, "Importante": 2, "Urgente": 1, "Regular": 0 };
  list.sort((a,b) => (rank[b.classificacao] - rank[a.classificacao]) || a.tarefa.localeCompare(b.tarefa));

  return list;
}

/* ========= Render Lista ========= */
function render(){
  const list = getFiltered();

  // badge de atrasadas (considera o dia selecionado)
  const overdueCount = tasks.filter(x => x.prazo === selectedDate && isOverdue(x)).length;
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

  // Botões dentro da lista (delegação)
  tasksList.querySelectorAll("[data-edit]").forEach(btn => {
    btn.onclick = () => openEdit(btn.getAttribute("data-edit"));
  });
  tasksList.querySelectorAll("[data-status]").forEach(btn => {
    btn.onclick = () => quickStatus(btn.getAttribute("data-id"), btn.getAttribute("data-status"));
  });
}

/* ========= Ações ========= */
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

function quickStatus(id, status){
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  t.status = status;
  t.updatedAt = new Date().toISOString();
  save();
  render();
}

function removeTask(){
  if (!editingId) return;
  tasks = tasks.filter(x => x.id !== editingId);
  save();
  closeModal();
  render();
}

/* ========= Validação + Salvar ========= */
function submitForm(e){
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
  } else {
    tasks.push({
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
    });
  }

  save();
  closeModal();

  // Se você salvou um prazo diferente do dia selecionado, muda a tela pro prazo salvo
  selectedDate = prazo;
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

/* ========= Exportar PDF =========
   No iPhone, isso abre a tela de impressão.
   Aí você salva como PDF pelo compartilhamento.
*/
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
btnDelete.onclick = removeTask;

taskForm.onsubmit = submitForm;

[searchInput, typeFilter, statusFilter, classFilter].forEach(el => {
  el.addEventListener("input", render);
  el.addEventListener("change", render);
});

/* ========= Start ========= */
init();
