const CLOUD_ID = "rocos-works-member-attendance";
const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
const diaryWorkOptions = ["弁当販売", "仕入れ", "仕込み", "調理", "盛り付け", "配達", "洗い物", "清掃", "内職"];

let state = null;
let cloudClient = null;
let cloudReady = false;
let saveTimer = null;

const els = {
  syncStatus: document.querySelector("#syncStatus"),
  todayLabel: document.querySelector("#todayLabel"),
  timeLabel: document.querySelector("#timeLabel"),
  punchDate: document.querySelector("#punchDate"),
  punchUser: document.querySelector("#punchUser"),
  punchStatus: document.querySelector("#punchStatus"),
  clockInButton: document.querySelector("#clockInButton"),
  clockOutButton: document.querySelector("#clockOutButton"),
  punchNotice: document.querySelector("#punchNotice"),
  todayList: document.querySelector("#todayList"),
  editDate: document.querySelector("#editDate"),
  editUser: document.querySelector("#editUser"),
  editStatus: document.querySelector("#editStatus"),
  editStart: document.querySelector("#editStart"),
  editEnd: document.querySelector("#editEnd"),
  editBreak: document.querySelector("#editBreak"),
  editMeal: document.querySelector("#editMeal"),
  editTransportGo: document.querySelector("#editTransportGo"),
  editTransportReturn: document.querySelector("#editTransportReturn"),
  editMemo: document.querySelector("#editMemo"),
  saveEditButton: document.querySelector("#saveEditButton"),
  deleteEditButton: document.querySelector("#deleteEditButton"),
  editNotice: document.querySelector("#editNotice"),
  extraDate: document.querySelector("#extraDate"),
  extraUser: document.querySelector("#extraUser"),
  dailyExtras: document.querySelector("#dailyExtras"),
  weeklyExtras: document.querySelector("#weeklyExtras"),
  monthlyExtras: document.querySelector("#monthlyExtras"),
  pieceExtras: document.querySelector("#pieceExtras"),
  diaryDate: document.querySelector("#diaryDate"),
  diaryWorkOptions: document.querySelector("#diaryWorkOptions"),
  diaryExtraWork: document.querySelector("#diaryExtraWork"),
  diaryNotice: document.querySelector("#diaryNotice"),
  adminDate: document.querySelector("#adminDate"),
  adminList: document.querySelector("#adminList")
};

init();

async function init() {
  setInitialDates();
  bindEvents();
  tick();
  window.setInterval(tick, 1000);
  setupCloud();
  state = await loadState();
  render();
}

function setInitialDates() {
  const today = dateKey(new Date());
  ["punchDate", "editDate", "extraDate", "diaryDate", "adminDate"].forEach((key) => {
    els[key].value = today;
  });
}

function bindEvents() {
  document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => switchPage(button.dataset.page));
  });
  ["punchDate", "editDate", "extraDate", "diaryDate"].forEach((key) => {
    els[key].addEventListener("change", () => syncDates(els[key].value));
  });
  els.adminDate.addEventListener("change", renderAdminList);
  ["punchUser", "editUser", "extraUser"].forEach((key) => {
    els[key].addEventListener("change", () => syncUsers(els[key].value));
  });
  els.clockInButton.addEventListener("click", () => runAction(clockIn, els.punchNotice));
  els.clockOutButton.addEventListener("click", () => runAction(clockOut, els.punchNotice));
  els.saveEditButton.addEventListener("click", () => runAction(saveEditRecord, els.editNotice));
  els.deleteEditButton.addEventListener("click", () => runAction(deleteEditRecord, els.editNotice));
  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-extra]")) runAction(() => handleExtraChange(event), els.editNotice);
    if (event.target.matches("[data-diary-work]")) runAction(handleDiaryWorkChange, els.diaryNotice);
  });
  els.diaryExtraWork.addEventListener("input", () => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => runAction(handleDiaryExtraWork, els.diaryNotice), 500);
  });
}

function switchPage(page) {
  document.querySelectorAll("[data-page]").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  document.querySelectorAll(".page").forEach((section) => section.classList.toggle("active", section.id === `${page}Page`));
}

function syncDates(value) {
  ["punchDate", "editDate", "extraDate", "diaryDate"].forEach((key) => {
    els[key].value = value;
  });
  render();
}

function syncUsers(value) {
  ["punchUser", "editUser", "extraUser"].forEach((key) => {
    if ([...els[key].options].some((option) => option.value === value)) els[key].value = value;
  });
  render();
}

async function runAction(action, noticeEl) {
  try {
    setStatus("保存中です");
    await action();
    setStatus(cloudReady ? "クラウド保存済み" : "この端末に保存中");
  } catch (error) {
    console.error(error);
    if (noticeEl) noticeEl.textContent = "保存できませんでした。通信を確認して、もう一度押してください。";
    setStatus("保存できませんでした");
  }
}

function setupCloud() {
  if (!window.ROCO_CLOUD_CONFIG || !window.supabase) {
    cloudReady = false;
    setStatus("クラウド設定がありません");
    return false;
  }
  cloudClient = window.supabase.createClient(
    window.ROCO_CLOUD_CONFIG.supabaseUrl,
    window.ROCO_CLOUD_CONFIG.supabaseAnonKey
  );
  cloudReady = true;
  return true;
}

async function loadState() {
  if (cloudReady) {
    try {
      const { data, error } = await cloudClient
        .from("register_state")
        .select("data")
        .eq("id", CLOUD_ID)
        .single();
      if (!error && data && data.data) {
        localStorage.setItem("rocos-member-attendance-cache", JSON.stringify(data.data));
        setStatus("クラウドから読み込みました");
        return normalizeState(data.data);
      }
      const seeded = await loadSeedState();
      await saveWholeState(seeded);
      setStatus("初期データをクラウドへ保存しました");
      return seeded;
    } catch (error) {
      console.error(error);
      setStatus("クラウドにつながりません。端末保存を表示中");
    }
  }
  return normalizeState(JSON.parse(localStorage.getItem("rocos-member-attendance-cache") || "null") || await loadSeedState());
}

async function loadLatestState() {
  if (!cloudReady) return state;
  const { data, error } = await cloudClient
    .from("register_state")
    .select("data")
    .eq("id", CLOUD_ID)
    .single();
  if (error || !data || !data.data) return state;
  state = normalizeState(data.data);
  return state;
}

async function loadSeedState() {
  const response = await fetch("seed-data.json", { cache: "no-store" });
  if (!response.ok) throw new Error("初期データを読み込めません");
  return normalizeState(await response.json());
}

async function saveWholeState(nextState) {
  state = normalizeState(nextState);
  localStorage.setItem("rocos-member-attendance-cache", JSON.stringify(state));
  if (!cloudReady) return false;
  const { error } = await cloudClient
    .from("register_state")
    .upsert({
      id: CLOUD_ID,
      data: state,
      updated_at: new Date().toISOString()
    });
  if (error) throw error;
  return true;
}

async function patchState(mutator) {
  const latest = normalizeState(await loadLatestState());
  mutator(latest);
  latest.updatedAt = new Date().toISOString();
  await saveWholeState(latest);
  render();
}

function normalizeState(raw = {}) {
  return {
    month: raw.month || monthKey(new Date()),
    taskVersion: raw.taskVersion || 2,
    settings: raw.settings || {},
    users: Array.isArray(raw.users) ? raw.users : [],
    attendance: raw.attendance && typeof raw.attendance === "object" ? raw.attendance : {},
    taskRates: raw.taskRates || { daily: [], weekly: [], monthly: [], piece: [] },
    taskDaily: raw.taskDaily && typeof raw.taskDaily === "object" ? raw.taskDaily : {},
    taskMonthly: raw.taskMonthly || {},
    diary: raw.diary && typeof raw.diary === "object" ? raw.diary : {},
    wageAdjustments: raw.wageAdjustments || {}
  };
}

function render() {
  if (!state) return;
  syncUserOptions();
  renderPunchStatus();
  renderTodayList();
  renderEditForm();
  renderExtraInputs();
  renderDiaryInputs();
  renderAdminList();
}

function syncUserOptions() {
  const options = state.users.map((user) => `<option value="${user.id}">${escapeHtml(user.name)}</option>`).join("");
  const values = {
    punchUser: els.punchUser.value,
    editUser: els.editUser.value,
    extraUser: els.extraUser.value
  };
  ["punchUser", "editUser", "extraUser"].forEach((key) => {
    els[key].innerHTML = options;
    if (state.users.some((user) => user.id === values[key])) els[key].value = values[key];
  });
  if (!els.punchUser.value && state.users[0]) els.punchUser.value = state.users[0].id;
  if (!els.editUser.value) els.editUser.value = els.punchUser.value;
  if (!els.extraUser.value) els.extraUser.value = els.punchUser.value;
}

async function clockIn() {
  const user = currentUser("punch");
  if (!user) return;
  const date = els.punchDate.value || dateKey(new Date());
  const key = recordKey(date, user.id);
  await patchState((next) => {
    const record = next.attendance[key] || {};
    if (record.status === "出勤" && record.start && !record.end) throw new Error("already in");
    if (record.status === "出勤" && record.start && record.end) throw new Error("already done");
    next.attendance[key] = {
      ...record,
      status: "出勤",
      start: timeKey(new Date()),
      end: "",
      breakMinutes: record.breakMinutes ?? 60,
      meal: record.meal ?? false,
      transportGo: transportGoChecked(record),
      transportReturn: transportReturnChecked(record),
      transport: transportGoChecked(record) || transportReturnChecked(record),
      memo: record.memo || ""
    };
    next.month = date.slice(0, 7);
  });
  showPunchNotice(`${user.name} さんの出勤を記録しました。`);
}

async function clockOut() {
  const user = currentUser("punch");
  if (!user) return;
  const date = els.punchDate.value || dateKey(new Date());
  const key = recordKey(date, user.id);
  await patchState((next) => {
    const record = next.attendance[key];
    if (!record || record.status !== "出勤" || !record.start) throw new Error("no clock in");
    if (record.end) throw new Error("already out");
    record.end = timeKey(new Date());
    next.month = date.slice(0, 7);
  });
  showPunchNotice(`${user.name} さんの退勤を記録しました。`);
}

async function saveEditRecord() {
  const user = currentUser("edit");
  if (!user) return;
  const date = els.editDate.value || dateKey(new Date());
  const key = recordKey(date, user.id);
  await patchState((next) => {
    if (!els.editStatus.value) {
      delete next.attendance[key];
      delete next.taskDaily[key];
    } else {
      next.attendance[key] = {
        ...(next.attendance[key] || {}),
        status: els.editStatus.value,
        start: els.editStart.value || "09:30",
        end: els.editEnd.value || "",
        breakMinutes: Number(els.editBreak.value || 0),
        meal: els.editMeal.checked,
        transportGo: els.editTransportGo.checked,
        transportReturn: els.editTransportReturn.checked,
        transport: els.editTransportGo.checked || els.editTransportReturn.checked,
        memo: els.editMemo.value.trim()
      };
      if (!["出勤", "在宅"].includes(els.editStatus.value)) delete next.taskDaily[key];
    }
    next.month = date.slice(0, 7);
  });
  showEditNotice("訂正を保存しました。");
}

async function deleteEditRecord() {
  const user = currentUser("edit");
  if (!user) return;
  const date = els.editDate.value || dateKey(new Date());
  if (!confirm(`${user.name} さんの ${date} の記録を削除しますか？`)) return;
  const key = recordKey(date, user.id);
  await patchState((next) => {
    delete next.attendance[key];
    delete next.taskDaily[key];
  });
  showEditNotice("記録を削除しました。");
}

function renderPunchStatus() {
  const user = currentUser("punch");
  if (!user) {
    els.punchStatus.textContent = "利用者が登録されていません";
    return;
  }
  const record = state.attendance[recordKey(els.punchDate.value, user.id)] || {};
  if (record.status === "出勤" && record.start && record.end) {
    els.punchStatus.textContent = `退勤済み ${record.start} - ${record.end}`;
  } else if (record.status === "出勤" && record.start) {
    els.punchStatus.textContent = `出勤中 ${record.start}`;
  } else if (record.status) {
    els.punchStatus.textContent = record.status;
  } else {
    els.punchStatus.textContent = "まだ打刻していません";
  }
}

function renderTodayList() {
  const date = els.punchDate.value;
  const rows = state.users
    .map((user) => ({ user, record: state.attendance[recordKey(date, user.id)] || {} }))
    .filter((row) => row.record.status);
  els.todayList.innerHTML = rows.length ? rows.map(({ user, record }) => `
    <div class="today-row">
      <strong>${escapeHtml(user.name)}</strong>
      <span>${escapeHtml(record.status)} ${escapeHtml(record.start || "")}${record.end ? ` - ${escapeHtml(record.end)}` : ""}</span>
    </div>
  `).join("") : `<div class="today-row"><strong>まだ記録がありません</strong><span></span></div>`;
}

function renderEditForm() {
  const user = currentUser("edit");
  if (!user) return;
  const record = state.attendance[recordKey(els.editDate.value, user.id)] || {};
  els.editStatus.value = record.status || "";
  els.editStart.value = record.start || "";
  els.editEnd.value = record.end || "";
  els.editBreak.value = record.breakMinutes ?? 60;
  els.editMeal.checked = Boolean(record.meal);
  els.editTransportGo.checked = transportGoChecked(record);
  els.editTransportReturn.checked = transportReturnChecked(record);
  els.editMemo.value = record.memo || "";
}

function renderExtraInputs() {
  const user = currentUser("extra");
  if (!user) return;
  const date = els.extraDate.value || dateKey(new Date());
  els.dailyExtras.innerHTML = taskGroupHtml("daily", date, user.id, "select");
  els.weeklyExtras.innerHTML = taskGroupHtml("weekly", date, user.id, "select");
  els.monthlyExtras.innerHTML = taskGroupHtml("monthly", date, user.id, "select");
  els.pieceExtras.innerHTML = taskGroupHtml("piece", date, user.id, "number");
}

function taskGroupHtml(group, date, userId, type) {
  const tasks = state.taskRates[group] || [];
  if (!tasks.length) return `<p class="notice">項目がありません。</p>`;
  return tasks.map((task, index) => {
    const taskIndex = task.key || index;
    const value = getDailyTaskValue(date, userId, group, taskIndex);
    const control = type === "number"
      ? `<input data-extra data-date="${date}" data-user="${userId}" data-group="${group}" data-index="${taskIndex}" type="number" min="0" step="1" value="${value || ""}">`
      : `<select data-extra data-date="${date}" data-user="${userId}" data-group="${group}" data-index="${taskIndex}">
          <option value="0" ${String(value) === "0" ? "selected" : ""}>なし</option>
          <option value="0.5" ${String(value) === "0.5" ? "selected" : ""}>半分</option>
          <option value="1" ${String(value) === "1" ? "selected" : ""}>1人分</option>
        </select>`;
    return `
      <div class="extra-row">
        <div><strong>${escapeHtml(task.name)}</strong><span>${yen.format(Number(task.amount) || 0)}</span></div>
        ${control}
      </div>
    `;
  }).join("");
}

async function handleExtraChange(event) {
  const { date, user, group, index } = event.target.dataset;
  const key = recordKey(date, user);
  const amount = Number(event.target.value) || 0;
  await patchState((next) => {
    next.taskDaily[key] = next.taskDaily[key] || {};
    next.taskDaily[key][group] = next.taskDaily[key][group] || {};
    next.taskDaily[key][group][index] = amount;
    next.month = date.slice(0, 7);
  });
}

function renderDiaryInputs() {
  const date = els.diaryDate.value || dateKey(new Date());
  const record = state.diary[date] || {};
  const selected = record.workTypes || [];
  els.diaryWorkOptions.innerHTML = diaryWorkOptions.map((option) => `
    <label class="work-option">
      <input data-diary-work type="checkbox" value="${escapeAttr(option)}" ${selected.includes(option) ? "checked" : ""}>
      <span>${escapeHtml(option)}</span>
    </label>
  `).join("");
  els.diaryExtraWork.value = record.extraWork || record.work || "";
}

async function handleDiaryWorkChange() {
  const date = els.diaryDate.value || dateKey(new Date());
  const workTypes = [...els.diaryWorkOptions.querySelectorAll("[data-diary-work]:checked")].map((input) => input.value);
  await patchState((next) => {
    next.diary[date] = next.diary[date] || {};
    next.diary[date].workTypes = workTypes;
    next.month = date.slice(0, 7);
  });
  showDiaryNotice("作業内容を保存しました。");
}

async function handleDiaryExtraWork() {
  const date = els.diaryDate.value || dateKey(new Date());
  await patchState((next) => {
    next.diary[date] = next.diary[date] || {};
    next.diary[date].extraWork = els.diaryExtraWork.value;
    next.month = date.slice(0, 7);
  });
  showDiaryNotice("保存しました。");
}

function renderAdminList() {
  const date = els.adminDate.value || dateKey(new Date());
  const rows = state.users.map((user) => ({ user, record: state.attendance[recordKey(date, user.id)] || {} }));
  els.adminList.innerHTML = rows.map(({ user, record }) => `
    <div class="admin-row">
      <strong>${escapeHtml(user.name)}</strong>
      <span>${record.status ? `${escapeHtml(record.status)} ${escapeHtml(record.start || "")}${record.end ? ` - ${escapeHtml(record.end)}` : ""}` : "未入力"}</span>
    </div>
  `).join("");
}

function currentUser(kind) {
  const select = kind === "edit" ? els.editUser : kind === "extra" ? els.extraUser : els.punchUser;
  return state.users.find((user) => user.id === select.value);
}

function getDailyTaskValue(date, userId, group, index) {
  const key = recordKey(date, userId);
  return state.taskDaily[key]?.[group]?.[index] || 0;
}

function transportGoChecked(record = {}) {
  return Boolean(record.transportGo || (record.transport && record.transportGo !== false));
}

function transportReturnChecked(record = {}) {
  return Boolean(record.transportReturn || (record.transport && record.transportReturn !== false));
}

function setStatus(message) {
  els.syncStatus.textContent = message;
}

function showPunchNotice(message) {
  els.punchNotice.textContent = message;
}

function showEditNotice(message) {
  els.editNotice.textContent = message;
}

function showDiaryNotice(message) {
  els.diaryNotice.textContent = message;
}

function tick() {
  const now = new Date();
  els.todayLabel.textContent = now.toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" });
  els.timeLabel.textContent = now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function timeKey(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function recordKey(date, userId) {
  return `${date}:${userId}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}
