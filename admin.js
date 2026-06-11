const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0
});

const today = new Date();
const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
const TASK_VERSION = 2;
const CLOUD_ID = "rocos-works-member-attendance";
const CACHE_KEY = "rocos-member-attendance-cache";
const diaryWorkOptions = ["弁当販売", "仕入れ", "仕込み", "調理", "盛り付け", "配達", "洗い物", "清掃", "内職"];

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const defaultTaskRates = {
  daily: [
    { name: "1日調理責任者", amount: 100 },
    { name: "広報担当者", amount: 100 },
    { name: "洗濯干し、ゴミ捨て", amount: 100 },
    { name: "洗濯取り入れ、袋の整理", amount: 100 },
    { name: "レジ締め", amount: 100 },
    { name: "炊飯器、コーヒー機械洗浄", amount: 100 },
    { name: "日誌のメニュー、工程表記入", amount: 100 },
    { name: "ボード、弁当箱シール、伝票", amount: 200 },
    { name: "配達タッパーの消毒、整理", amount: 100 },
    { name: "冷蔵庫の温度管理、トイレ掃除", amount: 100 }
  ],
  weekly: [
    { name: "調理器具の配置、タッパー整理", amount: 100 },
    { name: "保育園タッパー洗浄、片付け", amount: 200 },
    { name: "保育園給食（前日、当日準備）", amount: 200 },
    { name: "在庫管理チェック表", amount: 200 },
    { name: "フライヤーの掃除", amount: 200 },
    { name: "ミゾ掃除（すくう、デッキブラシ）", amount: 200 },
    { name: "ミゾ掃除（仕切り、レンチ洗浄）", amount: 200 },
    { name: "スチコンの掃除", amount: 100 },
    { name: "コンロの清掃", amount: 100 },
    { name: "段ボールの整理", amount: 100 },
    { name: "外のゴミ箱、店の周りの掃除", amount: 100 }
  ],
  monthly: [
    { name: "教育係", amount: 200 },
    { name: "お米の管理", amount: 1000 },
    { name: "包丁管理", amount: 3000 },
    { name: "出勤簿、加算管理者", amount: 1500 },
    { name: "経費帳管理者", amount: 3000 }
  ],
  piece: [
    { key: "cookie", name: "クッキー販売", unit: "個", amount: 50 },
    { key: "frozenVacuum", name: "冷凍弁当の真空", unit: "個", amount: 5 }
  ]
};

const defaultState = {
  month: currentMonth,
  taskVersion: TASK_VERSION,
  settings: {
    hourlyRate: 320,
    specialRate: 350,
    mealCost: 250,
    holidayBonus: 500,
    perfectBonus: 1000
  },
  users: Array.from({ length: 13 }, (_, index) => ({
    id: newId(),
    name: `利用者${index + 1}`,
    birthday: ""
  })),
  attendance: {},
  taskRates: defaultTaskRates,
  taskCounts: {},
  taskDaily: {},
  taskMonthly: {},
  diary: {}
};

let state = deepClone(defaultState);
let saveTimer = null;
let cloudClient = null;
let cloudReady = false;

const els = {
  monthInput: document.querySelector("#monthInput"),
  hourlyRateInput: document.querySelector("#hourlyRateInput"),
  specialRateInput: document.querySelector("#specialRateInput"),
  mealCostInput: document.querySelector("#mealCostInput"),
  holidayBonusInput: document.querySelector("#holidayBonusInput"),
  perfectBonusInput: document.querySelector("#perfectBonusInput"),
  addUserButton: document.querySelector("#addUserButton"),
  userList: document.querySelector("#userList"),
  attendanceTable: document.querySelector("#attendanceTable"),
  attendanceTableShell: document.querySelector("#attendanceTableShell"),
  attendanceScrollTop: document.querySelector("#attendanceScrollTop"),
  wageTable: document.querySelector("#wageTable"),
  monthlyTaskCalendar: document.querySelector("#monthlyTaskCalendar"),
  taskSettings: document.querySelector("#taskSettings"),
  diaryTable: document.querySelector("#diaryTable"),
  slipsGrid: document.querySelector("#slipsGrid"),
  attendanceSummary: document.querySelector("#attendanceSummary"),
  wageSummary: document.querySelector("#wageSummary"),
  diarySummary: document.querySelector("#diarySummary"),
  exportButton: document.querySelector("#exportButton"),
  printButton: document.querySelector("#printButton"),
  importRegisterCsvButton: document.querySelector("#importRegisterCsvButton"),
  registerCsvInput: document.querySelector("#registerCsvInput")
};

init();

async function init() {
  bindStaticEvents();
  setupCloud();
  await loadSharedState();
  render();
}

async function loadSharedState() {
  if (cloudReady) {
    try {
      const { data, error } = await cloudClient
        .from("register_state")
        .select("data")
        .eq("id", CLOUD_ID)
        .single();
      if (!error && data && data.data) {
        state = migrateState(data.data);
        localStorage.setItem(CACHE_KEY, JSON.stringify(state));
        return;
      }
      state = migrateState(await loadSeedState());
      await saveStateNow();
      return;
    } catch (error) {
      console.error(error);
    }
  }
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    state = migrateState(cached || await loadSeedState());
  } catch {
    state = deepClone(defaultState);
  }
}

function setupCloud() {
  if (!window.ROCO_CLOUD_CONFIG || !window.supabase) return false;
  cloudClient = window.supabase.createClient(
    window.ROCO_CLOUD_CONFIG.supabaseUrl,
    window.ROCO_CLOUD_CONFIG.supabaseAnonKey
  );
  cloudReady = true;
  return true;
}

async function loadSeedState() {
  const response = await fetch("seed-data.json", { cache: "no-store" });
  if (!response.ok) throw new Error("seed-data.json could not be loaded");
  return response.json();
}

async function saveStateNow() {
  state = migrateState(state);
  localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  if (!cloudReady) return false;
  const { error } = await cloudClient
    .from("register_state")
    .upsert({
      id: CLOUD_ID,
      data: state,
      updated_at: new Date().toISOString()
    });
  if (error) {
    console.error(error);
    throw error;
  }
  return true;
}
function migrateState(saved) {
  const taskRates = saved.taskVersion === TASK_VERSION && saved.taskRates
    ? {
        daily: mergeTasks(defaultTaskRates.daily, saved.taskRates.daily),
        weekly: mergeTasks(defaultTaskRates.weekly, saved.taskRates.weekly),
        monthly: mergeTasks(defaultTaskRates.monthly, saved.taskRates.monthly),
        piece: mergePieceTasks(defaultTaskRates.piece, saved.taskRates.piece)
      }
    : deepClone(defaultTaskRates);

  const merged = {
    ...deepClone(defaultState),
    ...saved,
    taskVersion: TASK_VERSION,
    settings: { ...deepClone(defaultState.settings), ...(saved.settings || {}) },
    taskRates,
    taskCounts: saved.taskCounts || {},
    taskDaily: saved.taskDaily || {},
    taskMonthly: saved.taskMonthly || {},
    diary: saved.diary || {},
    attendance: saved.attendance || {}
  };

  if ((saved.users || []).length < 13) {
    const existing = saved.users || [];
    merged.users = [
      ...existing.map((user) => ({ birthday: "", ...user })),
      ...Array.from({ length: 13 - existing.length }, (_, index) => ({
        id: newId(),
        name: `利用者${existing.length + index + 1}`,
        birthday: ""
      }))
    ];
  } else {
    merged.users = (merged.users || []).map((user) => ({ birthday: "", ...user }));
  }

  return merged;
}

function mergeTasks(defaults, saved = []) {
  return defaults.map((task, index) => ({
    ...task,
    ...(saved[index] || {})
  }));
}

function mergePieceTasks(defaults, saved = []) {
  return defaults.map((task) => ({
    ...task,
    ...(saved.find((item) => item.key === task.key) || {})
  }));
}

function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await saveStateNow();
  }, 250);
}
function bindStaticEvents() {
  els.monthInput.addEventListener("change", (event) => {
    state.month = event.target.value || currentMonth;
    saveState();
    render();
  });

  [
    ["hourlyRateInput", "hourlyRate"],
    ["specialRateInput", "specialRate"],
    ["mealCostInput", "mealCost"],
    ["holidayBonusInput", "holidayBonus"],
    ["perfectBonusInput", "perfectBonus"]
  ].forEach(([inputId, settingKey]) => {
    els[inputId].addEventListener("input", (event) => {
      state.settings[settingKey] = Number(event.target.value) || 0;
      saveState();
      renderCalculatedViews();
    });
  });

  els.addUserButton.addEventListener("click", () => {
    state.users.push({ id: newId(), name: `利用者${state.users.length + 1}` });
    saveState();
    render();
  });

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab, .view").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      document.querySelector(`#${button.dataset.tab}View`).classList.add("active");
    });
  });

  if (els.exportButton) els.exportButton.addEventListener("click", exportCsv);
  if (els.printButton) els.printButton.addEventListener("click", printCurrentView);
  if (els.importRegisterCsvButton) els.importRegisterCsvButton.addEventListener("click", () => {
    if (els.registerCsvInput) els.registerCsvInput.click();
  });
  if (els.registerCsvInput) els.registerCsvInput.addEventListener("change", importRegisterCsv);
}

function render() {
  els.monthInput.value = state.month;
  els.hourlyRateInput.value = state.settings.hourlyRate;
  els.specialRateInput.value = state.settings.specialRate;
  els.mealCostInput.value = state.settings.mealCost;
  els.holidayBonusInput.value = state.settings.holidayBonus;
  els.perfectBonusInput.value = state.settings.perfectBonus;
  renderUsers();
  renderTaskSettings();
  renderAttendanceTable();
  renderDiaryTable();
  renderCalculatedViews();
}

function renderUsers() {
  els.userList.innerHTML = "";
  state.users.forEach((user) => {
    const row = document.querySelector("#userRowTemplate").content.firstElementChild.cloneNode(true);
    const input = row.querySelector(".user-name");
    const birthday = row.querySelector(".user-birthday");
    const remove = row.querySelector(".danger");
    input.value = user.name;
    birthday.value = user.birthday || "";
    input.addEventListener("change", (event) => {
      user.name = event.target.value || "名称未設定";
      saveState();
      render();
    });
    birthday.addEventListener("change", (event) => {
      user.birthday = event.target.value;
      saveState();
      renderSlips(state.users.map((item) => calculateUser(item)));
    });
    remove.addEventListener("click", () => {
      if (!confirm(`${user.name} さんを削除しますか？`)) return;
      state.users = state.users.filter((item) => item.id !== user.id);
      saveState();
      render();
    });
    els.userList.append(row);
  });
}

function renderAttendanceTable() {
  const days = monthDays();
  els.attendanceTable.innerHTML = `
    <thead>
      <tr>
        <th>日付</th>
        ${state.users.map((user) => `<th>${escapeHtml(user.name)}</th>`).join("")}
      </tr>
    </thead>
    <tbody>
      ${days.map((date) => `
        <tr class="${isClosedDay(date) ? "closed-day-row" : ""}">
          <td class="date-cell">${formatDateLabel(date)}</td>
          ${state.users.map((user) => attendanceCell(date, user)).join("")}
        </tr>
      `).join("")}
    </tbody>
  `;

  els.attendanceTable.querySelectorAll("[data-attendance]").forEach((field) => {
    field.addEventListener("change", handleAttendanceInput);
    field.addEventListener("input", handleAttendanceInput);
  });
  els.attendanceTable.querySelectorAll("[data-attendance-action]").forEach((button) => {
    button.addEventListener("click", handleAttendanceAction);
  });
  els.attendanceTable.querySelectorAll("[data-daily-task]").forEach((field) => {
    field.addEventListener("change", handleDailyTaskInput);
  });
  syncAttendanceScroll();
}

function syncAttendanceScroll() {
  if (!els.attendanceScrollTop || !els.attendanceTableShell || !els.attendanceTable) return;
  const inner = els.attendanceScrollTop.firstElementChild;
  if (inner) inner.style.width = `${els.attendanceTable.scrollWidth}px`;
  if (!els.attendanceScrollTop.dataset.bound) {
    els.attendanceScrollTop.addEventListener("scroll", () => {
      els.attendanceTableShell.scrollLeft = els.attendanceScrollTop.scrollLeft;
    });
    els.attendanceTableShell.addEventListener("scroll", () => {
      els.attendanceScrollTop.scrollLeft = els.attendanceTableShell.scrollLeft;
    });
    els.attendanceScrollTop.dataset.bound = "true";
  }
}

function attendanceCell(date, user) {
  const key = recordKey(date, user.id);
  const record = state.attendance[key] || {};
  const status = record.status || "";
  const showWorkFields = ["出勤", "在宅"].includes(status);
  const closed = isClosedDay(date);

  return `
    <td class="attendance-cell">
      <div class="status-line ${closed && !status ? "closed" : ""}">${status || (closed ? "休み" : "未入力")}</div>
      <div class="status-buttons">
        <button type="button" data-attendance-action data-date="${date}" data-user="${user.id}" data-status="出勤">出勤</button>
        <button type="button" data-attendance-action data-date="${date}" data-user="${user.id}" data-status="在宅">在宅</button>
        <button type="button" data-attendance-action data-date="${date}" data-user="${user.id}" data-status="欠席">欠席</button>
        ${status ? `<button type="button" data-attendance-action data-date="${date}" data-user="${user.id}" data-status="">取消</button>` : ""}
      </div>
      ${showWorkFields ? `
        <div class="time-grid">
          <input data-attendance data-date="${date}" data-user="${user.id}" data-field="start" type="time" value="${record.start || "09:30"}" title="開始">
          <input data-attendance data-date="${date}" data-user="${user.id}" data-field="end" type="time" value="${record.end || "15:30"}" title="終了">
          <input data-attendance data-date="${date}" data-user="${user.id}" data-field="breakMinutes" type="number" min="0" step="5" value="${record.breakMinutes !== undefined && record.breakMinutes !== null ? record.breakMinutes : 60}" placeholder="休憩分">
        </div>
        <div class="check-row">
          <label>
            <input data-attendance data-date="${date}" data-user="${user.id}" data-field="meal" type="checkbox" ${record.meal ? "checked" : ""}>
            食事
          </label>
          <label>
            <input data-attendance data-date="${date}" data-user="${user.id}" data-field="transportGo" type="checkbox" ${transportGoChecked(record) ? "checked" : ""}>
            送迎 行き
          </label>
          <label>
            <input data-attendance data-date="${date}" data-user="${user.id}" data-field="transportReturn" type="checkbox" ${transportReturnChecked(record) ? "checked" : ""}>
            送迎 帰り
          </label>
        </div>
        <textarea data-attendance data-date="${date}" data-user="${user.id}" data-field="memo" placeholder="作業・備考">${escapeHtml(record.memo || "")}</textarea>
        ${dailyTaskInputs(date, user.id)}
      ` : ""}
    </td>
  `;
}

function dailyTaskInputs(date, userId) {
  return `
    <details class="daily-task-details">
      <summary>加算</summary>
      ${dailyTaskGroup(date, userId, "毎日", "daily")}
      ${dailyTaskGroup(date, userId, "週作業", "weekly")}
      ${dailyEducationTask(date, userId)}
      ${dailyPieceGroup(date, userId)}
    </details>
  `;
}

function dailyTaskGroup(date, userId, label, group) {
  return `
    <section class="daily-task-group">
      <h4>${label}</h4>
      ${state.taskRates[group].map((task, index) => {
        const value = String(getDailyTaskValue(date, userId, group, index));
        return `
          <label>
            <span>${escapeHtml(task.name)}</span>
            <select data-daily-task data-date="${date}" data-user="${userId}" data-group="${group}" data-index="${index}">
              <option value="0" ${value === "0" ? "selected" : ""}>なし</option>
              <option value="0.5" ${value === "0.5" ? "selected" : ""}>半分</option>
              <option value="1" ${value === "1" ? "selected" : ""}>1人分</option>
            </select>
          </label>
        `;
      }).join("")}
    </section>
  `;
}

function dailyEducationTask(date, userId) {
  const task = state.taskRates.monthly[0];
  if (!task) return "";
  const value = String(getDailyTaskValue(date, userId, "monthly", 0));
  return `
    <section class="daily-task-group">
      <h4>1日加算</h4>
      <label>
        <span>${escapeHtml(task.name)}</span>
        <select data-daily-task data-date="${date}" data-user="${userId}" data-group="monthly" data-index="0">
          <option value="0" ${value === "0" ? "selected" : ""}>なし</option>
          <option value="0.5" ${value === "0.5" ? "selected" : ""}>半分</option>
          <option value="1" ${value === "1" ? "selected" : ""}>1人分</option>
        </select>
      </label>
    </section>
  `;
}

function dailyPieceGroup(date, userId) {
  return `
    <section class="daily-task-group">
      <h4>個数</h4>
      ${state.taskRates.piece.map((task) => `
        <label>
          <span>${escapeHtml(task.name)}（${yen.format(task.amount)}）</span>
          <input data-daily-task data-date="${date}" data-user="${userId}" data-group="piece" data-index="${task.key}" type="number" min="0" step="1" value="${getDailyTaskValue(date, userId, "piece", task.key) || ""}">
        </label>
      `).join("")}
    </section>
  `;
}

function handleDailyTaskInput(event) {
  const { date, user, group, index } = event.target.dataset;
  const key = recordKey(date, user);
  state.taskDaily[key] = state.taskDaily[key] || {};
  state.taskDaily[key][group] = state.taskDaily[key][group] || {};
  state.taskDaily[key][group][index] = Number(event.target.value) || 0;
  saveState();
  renderCalculatedViews();
}

function handleAttendanceAction(event) {
  const { date, user, status } = event.target.dataset;
  const key = recordKey(date, user);
  if (!status) {
    delete state.attendance[key];
    delete state.taskDaily[key];
  } else {
    state.attendance[key] = {
      ...(state.attendance[key] || {}),
      status,
      start: state.attendance[key] && state.attendance[key].start ? state.attendance[key].start : "09:30",
      end: state.attendance[key] && state.attendance[key].end ? state.attendance[key].end : "15:30",
      breakMinutes: state.attendance[key] && state.attendance[key].breakMinutes !== undefined && state.attendance[key].breakMinutes !== null ? state.attendance[key].breakMinutes : 60
    };
    if (!["出勤", "在宅"].includes(status)) {
      delete state.taskDaily[key];
    }
  }
  saveState();
  renderAttendanceTable();
  renderDiaryTable();
  renderCalculatedViews();
}

function handleAttendanceInput(event) {
  const { date, user, field } = event.target.dataset;
  const key = recordKey(date, user);
  state.attendance[key] = state.attendance[key] || {};
  if (field === "breakMinutes") {
    state.attendance[key][field] = Number(event.target.value) || 0;
  } else if (["meal", "transport", "transportGo", "transportReturn"].includes(field)) {
    state.attendance[key][field] = event.target.checked;
    if (["transportGo", "transportReturn"].includes(field)) {
      state.attendance[key].transport = transportGoChecked(state.attendance[key]) || transportReturnChecked(state.attendance[key]);
    }
  } else {
    state.attendance[key][field] = event.target.value;
  }
  saveState();
  renderDiaryTable();
  renderCalculatedViews();
}

function transportGoChecked(record = {}) {
  return Boolean(record.transportGo || (record.transport && record.transportGo !== false));
}

function transportReturnChecked(record = {}) {
  return Boolean(record.transportReturn || (record.transport && record.transportReturn !== false));
}

function renderDiaryTable() {
  const days = monthDays();
  els.diaryTable.innerHTML = `
    <thead>
      <tr>
        <th>日付</th>
        <th>通所 名前・人数</th>
        <th>在宅 名前・人数</th>
        <th>欠席 名前・人数</th>
        <th>弁当売上</th>
        <th>内職売上</th>
        <th>作業内容</th>
      </tr>
    </thead>
    <tbody>
      ${days.map((date) => {
        const record = state.diary[date] || {};
        const summary = daySummary(date);
        return `
          <tr>
            <td class="date-cell">${formatDateLabel(date)}</td>
            <td>${namesBlock(summary.office)}</td>
            <td>${namesBlock(summary.remote)}</td>
            <td>${namesBlock(summary.absent)}</td>
            <td>
              <input class="money-input" data-diary data-money data-date="${date}" data-field="bentoSales" type="text" inputmode="numeric" value="${formatMoneyInput(record.bentoSales)}" placeholder="0">
              <span class="print-only">${yen.format(Number(record.bentoSales) || 0)}</span>
            </td>
            <td>
              <input class="money-input" data-diary data-money data-date="${date}" data-field="pieceworkSales" type="text" inputmode="numeric" value="${formatMoneyInput(record.pieceworkSales)}" placeholder="0">
              <span class="print-only">${yen.format(Number(record.pieceworkSales) || 0)}</span>
            </td>
            <td>${diaryWorkCell(date, record)}</td>
          </tr>
        `;
      }).join("")}
      ${diaryTotalRow()}
    </tbody>
  `;

  els.diaryTable.querySelectorAll("[data-diary]").forEach((field) => {
    field.addEventListener("change", handleDiaryInput);
    field.addEventListener("input", handleDiaryInput);
    if (field.matches("[data-money]")) {
      field.addEventListener("blur", () => {
        field.value = formatMoneyInput(parseMoneyInput(field.value));
      });
      field.addEventListener("focus", () => {
        field.value = String(parseMoneyInput(field.value) || "");
      });
    }
  });
}

function diaryWorkCell(date, record) {
  const selected = record.workTypes || [];
  return `
    <div class="print-only">${escapeHtml(printWorkText(record))}</div>
    <div class="work-options">
      ${diaryWorkOptions.map((option) => `
        <label>
          <input data-diary data-date="${date}" data-field="workTypes" type="checkbox" value="${escapeHtml(option)}" ${selected.includes(option) ? "checked" : ""}>
          ${escapeHtml(option)}
        </label>
      `).join("")}
    </div>
    <textarea data-diary data-date="${date}" data-field="extraWork" placeholder="その他・追加でやったこと">${escapeHtml(record.extraWork !== undefined && record.extraWork !== null ? record.extraWork : (record.work || ""))}</textarea>
  `;
}

function diaryTotalRow() {
  const totals = diaryTotals();
  const attendanceTotals = diaryAttendanceTotals();
  return `
    <tr class="diary-total-row">
      <td>合計</td>
      <td>${attendanceTotals.office}人</td>
      <td>${attendanceTotals.remote}人</td>
      <td>${attendanceTotals.absent}人</td>
      <td><span class="print-only">${yen.format(totals.bentoSales)}</span><strong class="screen-total">${yen.format(totals.bentoSales)}</strong></td>
      <td><span class="print-only">${yen.format(totals.pieceworkSales)}</span><strong class="screen-total">${yen.format(totals.pieceworkSales)}</strong></td>
      <td>売上合計 ${yen.format(totals.bentoSales + totals.pieceworkSales)}</td>
    </tr>
  `;
}

function printWorkText(record) {
  const selected = record.workTypes || [];
  const extra = record.extraWork !== undefined && record.extraWork !== null ? record.extraWork : (record.work || "");
  return [...selected, extra].filter((item) => String(item).trim() !== "").join("、") || "-";
}

function handleDiaryInput(event) {
      const { date, field: fieldName } = event.target.dataset;
      state.diary[date] = state.diary[date] || {};
      if (fieldName === "workTypes") {
        const values = [...els.diaryTable.querySelectorAll(`[data-diary][data-date="${date}"][data-field="workTypes"]:checked`)]
          .map((item) => item.value);
        state.diary[date].workTypes = values;
      } else {
        state.diary[date][fieldName] = ["bentoSales", "pieceworkSales"].includes(fieldName)
          ? parseMoneyInput(event.target.value)
          : event.target.value;
      }
      saveState();
      renderCalculatedViews();
}

function parseMoneyInput(value) {
  return Number(String(value).split(",").join("").replace(/[^\d]/g, "")) || 0;
}

function formatMoneyInput(value) {
  const number = Number(value) || 0;
  return number ? number.toLocaleString("ja-JP") : "";
}

async function importRegisterCsv(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;

  const text = await file.text();
  const rows = parseCsv(text);
  const imported = extractRegisterSales(rows);
  const entries = Object.entries(imported).filter(([date]) => date.startsWith(state.month));

  if (!entries.length) {
    alert("対象月の売上を見つけられませんでした。CSVの日付と売上の列を確認してください。");
    return;
  }

  const conflicts = entries.filter(([date, sales]) => {
    const current = Number(state.diary[date] && state.diary[date].bentoSales) || 0;
    return current && current !== sales;
  });
  const shouldOverwrite = !conflicts.length || confirm(`すでに金額が入っている日が${conflicts.length}日あります。CSVの金額で上書きしますか？`);

  entries.forEach(([date, sales]) => {
    state.diary[date] = state.diary[date] || {};
    if (!shouldOverwrite && Number(state.diary[date].bentoSales)) return;
    state.diary[date].bentoSales = sales;
  });
  saveState();
  renderDiaryTable();
  renderCalculatedViews();
  alert(`${entries.length}日分の弁当売上を取り込みました。`);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted && char === '"' && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((item) => item.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((item) => item.trim() !== "")) rows.push(row);
  return rows;
}

function extractRegisterSales(rows) {
  if (!rows.length) return {};
  const header = rows[0].map((cell) => normalizeCell(cell));
  const dateIndex = header.findIndex((cell) => ["日付", "日時", "date", "販売日", "売上日"].some((key) => cell.includes(key)));
  const salesIndex = header.findIndex((cell) => ["売上", "合計", "小計", "金額", "total", "amount"].some((key) => cell.includes(key)));
  const dataRows = dateIndex >= 0 && salesIndex >= 0 ? rows.slice(1) : rows;
  const result = {};

  dataRows.forEach((row) => {
    const date = dateIndex >= 0 ? normalizeDate(row[dateIndex]) : findDateInRow(row);
    if (!date) return;
    const sales = salesIndex >= 0 ? parseMoneyInput(row[salesIndex]) : findLargestMoneyInRow(row);
    if (!sales) return;
    result[date] = (result[date] || 0) + sales;
  });

  return result;
}

function normalizeCell(value) {
  return String(value || "").trim().toLowerCase();
}

function findDateInRow(row) {
  for (const cell of row) {
    const date = normalizeDate(cell);
    if (date) return date;
  }
  return "";
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  let match = text.match(/(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }

  match = text.match(/(\d{1,2})[\/.-](\d{1,2})/);
  if (match) {
    const year = state.month.slice(0, 4);
    return `${year}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  }

  return "";
}

function findLargestMoneyInRow(row) {
  return row.reduce((max, cell) => Math.max(max, parseMoneyInput(cell)), 0);
}

function renderCalculatedViews() {
  const rows = state.users.map((user) => calculateUser(user));
  const totals = rows.reduce((acc, row) => ({
    days: acc.days + row.days,
    hours: acc.hours + row.hours,
    base: acc.base + row.base,
    tasks: acc.tasks + row.taskPay,
    holiday: acc.holiday + row.holidayBonus,
    perfect: acc.perfect + row.perfectBonus,
    meals: acc.meals + row.mealDeduction,
    pay: acc.pay + row.total
  }), { days: 0, hours: 0, base: 0, tasks: 0, holiday: 0, perfect: 0, meals: 0, pay: 0 });
  const diary = diaryTotals();

  els.attendanceSummary.innerHTML = summaryHtml([
    ["出勤延べ", `${totals.days}日`],
    ["作業時間", `${round(totals.hours)}時間`],
    ["食数", `${mealCountFromDeduction(totals.meals)}食`]
  ]);

  els.wageSummary.innerHTML = summaryHtml([
    ["時間工賃", yen.format(totals.base)],
    ["作業加算", yen.format(totals.tasks)],
    ["休日加算", yen.format(totals.holiday)],
    ["皆勤手当", yen.format(totals.perfect)],
    ["食費控除", yen.format(totals.meals)],
    ["支給合計", yen.format(totals.pay)]
  ]);

  els.diarySummary.innerHTML = summaryHtml([
    ["弁当売上", yen.format(diary.bentoSales)],
    ["内職売上", yen.format(diary.pieceworkSales)],
    ["売上合計", yen.format(diary.bentoSales + diary.pieceworkSales)]
  ]);

  renderMonthlyTaskCalendar();
  renderWageTable(rows);
  renderSlips(rows);
}

function renderTaskSettings() {
  els.taskSettings.innerHTML = `
    ${taskSettingsGroup("毎日する作業", "daily")}
    ${taskSettingsGroup("週1、2回の作業", "weekly")}
    ${taskSettingsGroup("その他", "monthly")}
    ${pieceSettingsGroup()}
  `;

  els.taskSettings.querySelectorAll("[data-task-rate], [data-task-name]").forEach((field) => {
    field.addEventListener("change", handleTaskSettingInput);
  });
}

function taskSettingsGroup(label, group) {
  return `
    <section class="task-settings-group">
      <h3>${label}</h3>
      ${state.taskRates[group].map((task, index) => `
        <div class="task-setting-row">
          <input data-task-name data-group="${group}" data-index="${index}" value="${escapeHtml(task.name)}" aria-label="作業名">
          <input data-task-rate data-group="${group}" data-index="${index}" type="number" min="0" step="1" value="${task.amount}" aria-label="単価">
        </div>
      `).join("")}
    </section>
  `;
}

function pieceSettingsGroup() {
  return `
    <section class="task-settings-group">
      <h3>個数で計算</h3>
      ${state.taskRates.piece.map((task) => `
        <div class="task-setting-row">
          <input data-task-name data-group="piece" data-index="${task.key}" value="${escapeHtml(task.name)}" aria-label="作業名">
          <input data-task-rate data-group="piece" data-index="${task.key}" type="number" min="0" step="1" value="${task.amount}" aria-label="単価">
        </div>
      `).join("")}
    </section>
  `;
}

function renderMonthlyTaskCalendar() {
  const days = monthDays();
  const firstDay = new Date(`${days[0]}T00:00:00`).getDay();
  const cells = [];

  for (let index = 0; index < firstDay; index += 1) {
    cells.push(`<div class="task-calendar-cell is-empty"></div>`);
  }

  days.forEach((date) => {
    const entries = dailyTaskEntriesForDate(date);
    cells.push(`
      <article class="task-calendar-cell ${isClosedDay(date) ? "closed" : ""}">
        <div class="task-calendar-date">${formatDateLabel(date)}</div>
        <div class="task-calendar-list">
          ${entries.length ? entries.map((entry) => `
            <div class="task-calendar-item">
              <strong>${escapeHtml(lastNameOnly(entry.userName))}</strong>
              <span>${escapeHtml(entry.name)}</span>
              <em>${entry.label}</em>
            </div>
          `).join("") : `<span class="task-calendar-none">-</span>`}
        </div>
      </article>
    `);
  });

  els.monthlyTaskCalendar.innerHTML = `
    <div class="monthly-task-layout">
      <div class="task-calendar-scroll">
        <div class="task-calendar-weekdays">
          ${["日", "月", "火", "水", "木", "金", "土"].map((day) => `<span>${day}</span>`).join("")}
        </div>
        <div class="task-calendar-grid">${cells.join("")}</div>
      </div>
      <aside class="monthly-assignee-panel">
        <h3>月額加算の対象者</h3>
        ${monthlyAssigneeInputs()}
      </aside>
    </div>
  `;

  els.monthlyTaskCalendar.querySelectorAll("[data-monthly-task-assignee]").forEach((field) => {
    field.addEventListener("change", handleMonthlyTaskAssignee);
  });
}

function monthlyAssigneeInputs() {
  return state.taskRates.monthly.map((task, index) => {
    if (index === 0) return "";
    const selected = getMonthlyTaskAssignee(index);
    return `
      <label class="monthly-assignee-row">
        <span>${escapeHtml(task.name)}（${yen.format(task.amount)}）</span>
        <select data-monthly-task-assignee data-index="${index}">
          <option value="" ${selected ? "" : "selected"}>対象者なし</option>
          ${state.users.map((user) => `
            <option value="${user.id}" ${selected === user.id ? "selected" : ""}>${escapeHtml(user.name)}</option>
          `).join("")}
        </select>
      </label>
    `;
  }).join("");
}

function handleMonthlyTaskAssignee(event) {
  const index = event.target.dataset.index;
  state.taskMonthly[state.month] = state.taskMonthly[state.month] || {};
  if (event.target.value) {
    state.taskMonthly[state.month][index] = event.target.value;
  } else {
    delete state.taskMonthly[state.month][index];
  }
  saveState();
  renderCalculatedViews();
}

function renderWageTable(rows) {
  els.wageTable.innerHTML = `
    <thead>
      <tr>
        <th>利用者</th>
        <th>出勤</th>
        <th>時間</th>
        <th>時間工賃</th>
        <th>作業加算</th>
        <th>休日加算</th>
        <th>皆勤</th>
        <th>食費</th>
        <th>支給額</th>
        <th>加算内訳</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((row) => `
        <tr>
          <td>${escapeHtml(row.user.name)}</td>
          <td>${row.days}日</td>
          <td>${round(row.hours)}時間</td>
          <td class="money">${yen.format(row.base)}</td>
          <td class="money">${yen.format(row.taskPay)}</td>
          <td class="money">${yen.format(row.holidayBonus)}</td>
          <td class="money">${yen.format(row.perfectBonus)}</td>
          <td class="money">${yen.format(row.mealDeduction)}</td>
          <td class="money"><strong>${yen.format(row.total)}</strong></td>
          <td>${taskBreakdownDetails(row.user.id)}</td>
        </tr>
      `).join("")}
    </tbody>
  `;
}

function taskBreakdownDetails(userId) {
  const dailyEntries = dailyTaskEntriesFor(userId).concat(monthlyTaskEntriesFor(userId));
  return `
    <details class="task-details">
      <summary>日別の加算記録を見る</summary>
      ${dailyTaskBreakdown(dailyEntries)}
    </details>
  `;
}

function dailyTaskBreakdown(entries) {
  if (!entries.length) {
    return `<div class="daily-task-empty">日別の加算はまだ入っていません。</div>`;
  }

  return `
    <div class="daily-task-breakdown">
      ${entries.map((entry) => `
        <div class="daily-task-entry">
          <span>${formatEntryDate(entry)}</span>
          <strong>${escapeHtml(entry.name)}</strong>
          <em>${entry.label}</em>
          <b>${yen.format(entry.amount)}</b>
        </div>
      `).join("")}
    </div>
  `;
}

function taskGroup(label, group, userId) {
  return `
    <section class="task-group">
      <h3>${label}</h3>
      ${state.taskRates[group].map((task, index) => {
        const count = String(getTaskCount(userId, group, index));
        return `
          <div class="task-row">
            <span>${escapeHtml(task.name)}（${yen.format(task.amount)}）</span>
            <select data-task-count data-user="${userId}" data-group="${group}" data-index="${index}" aria-label="加算">
              <option value="0" ${count === "0" ? "selected" : ""}>なし</option>
              <option value="0.5" ${count === "0.5" ? "selected" : ""}>半分</option>
              <option value="1" ${count === "1" ? "selected" : ""}>1人分</option>
            </select>
          </div>
        `;
      }).join("")}
    </section>
  `;
}

function pieceGroup(userId) {
  return `
    <section class="task-group">
      <h3>個数で計算</h3>
      ${state.taskRates.piece.map((task) => {
        const count = getTaskCount(userId, "piece", task.key);
        return `
          <div class="task-row">
            <span>${escapeHtml(task.name)}</span>
            <span>${yen.format(task.amount)}</span>
            <input data-task-count data-user="${userId}" data-group="piece" data-index="${task.key}" type="number" min="0" step="1" value="${count || ""}" aria-label="個数">
          </div>
        `;
      }).join("")}
    </section>
  `;
}

function handleTaskInput(event) {
  const { group, index, user } = event.target.dataset;
  state.taskCounts[user] = state.taskCounts[user] || {};
  state.taskCounts[user][group] = state.taskCounts[user][group] || {};
  state.taskCounts[user][group][index] = Number(event.target.value) || 0;
  saveState();
  renderCalculatedViews();
}

function handleTaskSettingInput(event) {
  const { group, index } = event.target.dataset;
  if (group === "piece") {
    const task = state.taskRates.piece.find((item) => item.key === index);
    if (event.target.matches("[data-task-name]")) task.name = event.target.value || task.name;
    if (event.target.matches("[data-task-rate]")) task.amount = Number(event.target.value) || 0;
  } else {
    if (event.target.matches("[data-task-name]")) {
      state.taskRates[group][Number(index)].name = event.target.value || state.taskRates[group][Number(index)].name;
    }
    if (event.target.matches("[data-task-rate]")) {
      state.taskRates[group][Number(index)].amount = Number(event.target.value) || 0;
    }
  }
  saveState();
  renderCalculatedViews();
}

function renderSlips(rows) {
  els.slipsGrid.innerHTML = rows.map((row) => `
    <article class="slip">
      <div class="print-slip-title">${formatEraMonthLabel(state.month)} 工賃明細</div>
      <h3>${escapeHtml(row.user.name)} さん</h3>
      ${isBirthdayMonth(row.user) ? `<p class="birthday-message">お誕生日おめでとう！！</p>` : ""}
      <dl>
        <dt>対象月</dt><dd>${formatMonthLabel(state.month)}</dd>
        <dt>出勤日数</dt><dd>${row.days}日</dd>
        <dt>作業時間</dt><dd>${round(row.hours)}時間</dd>
        <dt>時間工賃</dt><dd>${yen.format(row.base)}</dd>
        <dt>作業加算</dt><dd>${yen.format(row.taskPay)}</dd>
        <dt>休日出勤加算</dt><dd>${yen.format(row.holidayBonus)}</dd>
        <dt>皆勤手当</dt><dd>${yen.format(row.perfectBonus)}</dd>
        <dt>食費控除</dt><dd>${yen.format(row.mealDeduction)}</dd>
        <dt class="total">支給額</dt><dd class="total">${yen.format(row.total)}</dd>
      </dl>
    </article>
  `).join("");
}

function calculateUser(user) {
  const days = monthDays();
  const records = days.map((date) => state.attendance[recordKey(date, user.id)] || {});
  const worked = records.filter((record) => ["出勤", "在宅"].includes(record.status));
  const wageParts = records.map(wageForRecord);
  const hours = wageParts.reduce((sum, item) => sum + item.totalMinutes, 0) / 60;
  const base = wageParts.reduce((sum, item) => sum + item.pay, 0);
  const taskPay = taskPayFor(user.id);
  const holidayBonus = holidayBonusFor(user.id);
  const perfectBonus = perfectBonusFor(user.id);
  const mealDeduction = records.filter((record) => record.meal).length * state.settings.mealCost;
  const total = Math.max(0, Math.round(base + taskPay + holidayBonus + perfectBonus - mealDeduction));

  return {
    user,
    days: worked.length,
    hours,
    base: Math.round(base),
    taskPay,
    holidayBonus,
    perfectBonus,
    mealDeduction,
    total
  };
}

function isBirthdayMonth(user) {
  if (!user.birthday) return false;
  const birthdayMonth = Number(user.birthday.slice(5, 7));
  const targetMonth = Number(state.month.slice(5, 7));
  return birthdayMonth === targetMonth;
}

function wageForRecord(record) {
  if (!["出勤", "在宅"].includes(record.status)) {
    return { totalMinutes: 0, specialMinutes: 0, pay: 0 };
  }

  const start = timeToMinutes(record.start || "09:30");
  const end = timeToMinutes(record.end || "15:30");
  const rawMinutes = Math.max(0, end - start);
  const breakMinutes = record.breakMinutes === undefined || record.breakMinutes === "" ? 60 : Number(record.breakMinutes) || 0;
  const totalMinutes = Math.max(0, rawMinutes - breakMinutes);
  const specialRaw = overlapMinutes(start, end, 510, 570) + overlapMinutes(start, end, 930, 990);
  const specialMinutes = Math.min(totalMinutes, specialRaw);
  const regularMinutes = Math.max(0, totalMinutes - specialMinutes);
  const pay = (regularMinutes / 60) * state.settings.hourlyRate + (specialMinutes / 60) * state.settings.specialRate;

  return { totalMinutes, specialMinutes, pay };
}

function taskPayFor(userId) {
  const dailyPay = dailyTaskEntriesFor(userId).reduce((sum, entry) => sum + entry.amount, 0);
  const monthlyPay = monthlyTaskEntriesFor(userId).reduce((sum, entry) => sum + entry.amount, 0);
  return Math.round(dailyPay + monthlyPay);
}

function holidayBonusFor(userId) {
  const workedClosedDays = monthDays().filter((date) => {
    const record = state.attendance[recordKey(date, userId)] || {};
    return isClosedDay(date) && record.status === "出勤";
  }).length;
  return workedClosedDays * state.settings.holidayBonus;
}

function perfectBonusFor(userId) {
  const businessDays = monthDays().filter((date) => !isClosedDay(date));
  if (!businessDays.length) return 0;
  const allWorked = businessDays.every((date) => {
    const record = state.attendance[recordKey(date, userId)] || {};
    return ["出勤", "在宅"].includes(record.status);
  });
  return allWorked ? state.settings.perfectBonus : 0;
}

function getTaskCount(userId, group, index) {
  return state.taskCounts[userId] && state.taskCounts[userId][group] && state.taskCounts[userId][group][index] || 0;
}

function getDailyTaskValue(date, userId, group, index) {
  const key = recordKey(date, userId);
  return state.taskDaily[key] && state.taskDaily[key][group] && state.taskDaily[key][group][index] || 0;
}

function getMonthlyTaskAssignee(index) {
  return state.taskMonthly[state.month] && state.taskMonthly[state.month][index] || "";
}

function monthlyTaskEntriesFor(userId) {
  const entries = [];
  state.taskRates.monthly.forEach((task, index) => {
    if (index === 0) return;
    if (getMonthlyTaskAssignee(index) !== userId) return;
    entries.push({
      date: state.month,
      name: task.name,
      label: "月額",
      amount: Number(task.amount) || 0
    });
  });
  return entries;
}

function dailyTaskEntriesFor(userId) {
  const entries = [];
  monthDays().forEach((date) => {
    entries.push(...dailyTaskEntriesForUserAndDate(userId, date));
  });
  return entries;
}

function dailyTaskEntriesForDate(date) {
  const entries = [];
  state.users.forEach((user) => {
    dailyTaskEntriesForUserAndDate(user.id, date).forEach((entry) => {
      entries.push({
        ...entry,
        userName: user.name
      });
    });
  });
  return entries;
}

function dailyTaskEntriesForUserAndDate(userId, date) {
  const entries = [];
  ["daily", "weekly"].forEach((group) => {
    state.taskRates[group].forEach((task, index) => {
      const count = Number(getDailyTaskValue(date, userId, group, index)) || 0;
      if (!count) return;
      entries.push({
        date,
        name: task.name,
        label: count === 0.5 ? "半分" : "1人分",
        amount: Math.round(count * (Number(task.amount) || 0))
      });
    });
  });

  const educationTask = state.taskRates.monthly[0];
  const educationCount = Number(getDailyTaskValue(date, userId, "monthly", 0)) || 0;
  if (educationTask && educationCount) {
    entries.push({
      date,
      name: educationTask.name,
      label: educationCount === 0.5 ? "半分" : "1人分",
      amount: Math.round(educationCount * (Number(educationTask.amount) || 0))
    });
  }

  state.taskRates.piece.forEach((task) => {
    const count = Number(getDailyTaskValue(date, userId, "piece", task.key)) || 0;
    if (!count) return;
    entries.push({
      date,
      name: task.name,
      label: `${count}個`,
      amount: Math.round(count * (Number(task.amount) || 0))
    });
  });
  return entries;
}

function mealCountFromDeduction(totalDeduction) {
  if (!state.settings.mealCost) return 0;
  return Math.round(totalDeduction / state.settings.mealCost);
}

function daySummary(date) {
  const result = { office: [], remote: [], absent: [] };
  state.users.forEach((user) => {
    const attendanceRecord = state.attendance[recordKey(date, user.id)] || {};
    const status = attendanceRecord.status;
    if (status === "出勤") result.office.push(user.name);
    if (status === "在宅") result.remote.push(user.name);
    if (status === "欠席") result.absent.push(user.name);
  });
  return result;
}

function namesBlock(names) {
  return `<strong>${names.length}人</strong><br><span class="names">${escapeHtml(names.map(lastNameOnly).join("、") || "-")}</span>`;
}

function lastNameOnly(name) {
  return String(name || "").trim().split(/[ 　]+/)[0] || name;
}

function diaryTotals() {
  return Object.entries(state.diary)
    .filter(([date]) => date.startsWith(state.month))
    .reduce((acc, [, record]) => ({
      bentoSales: acc.bentoSales + (Number(record.bentoSales) || 0),
      pieceworkSales: acc.pieceworkSales + (Number(record.pieceworkSales) || 0)
    }), { bentoSales: 0, pieceworkSales: 0 });
}

function diaryAttendanceTotals() {
  return monthDays().reduce((totals, date) => {
    const summary = daySummary(date);
    totals.office += summary.office.length;
    totals.remote += summary.remote.length;
    totals.absent += summary.absent.length;
    return totals;
  }, { office: 0, remote: 0, absent: 0 });
}

function monthDays() {
  const [year, month] = state.month.split("-").map(Number);
  const last = new Date(year, month, 0).getDate();
  return Array.from({ length: last }, (_, index) => {
    return `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`;
  });
}

function formatDateLabel(date) {
  const dayNames = ["日", "月", "火", "水", "木", "金", "土"];
  const parsed = new Date(`${date}T00:00:00`);
  const holiday = holidayName(date);
  return `${date.slice(5)} (${dayNames[parsed.getDay()]})${holiday ? `<span class="holiday-name">${holiday}</span>` : ""}`;
}

function formatShortDate(date) {
  return date.slice(5).replace("-", "/");
}

function formatMonthLabel(monthValue) {
  const month = Number(String(monthValue || "").slice(5, 7));
  return month ? `${month}月` : monthValue;
}

function formatEraMonthLabel(monthValue) {
  const parts = String(monthValue || "").split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!year || !month) return monthValue;
  if (year >= 2019) return `令和${year - 2018}年${month}月`;
  return `${year}年${month}月`;
}

function formatEntryDate(entry) {
  return entry.label === "月額" ? "月額" : formatShortDate(entry.date);
}

function recordKey(date, userId) {
  return `${date}:${userId}`;
}

function timeToMinutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function overlapMinutes(start, end, windowStart, windowEnd) {
  return Math.max(0, Math.min(end, windowEnd) - Math.max(start, windowStart));
}

function isClosedDay(date) {
  const parsed = new Date(`${date}T00:00:00`);
  return [0, 6].includes(parsed.getDay()) || Boolean(holidayName(date));
}

function holidayName(date) {
  const [year] = date.split("-").map(Number);
  return getJapaneseHolidays(year).get(date) || "";
}

function getJapaneseHolidays(year) {
  const holidays = new Map();
  const add = (month, day, name) => {
    holidays.set(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, name);
  };
  const monday = (month, week) => {
    const first = new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00`);
    const offset = (8 - first.getDay()) % 7;
    return 1 + offset + (week - 1) * 7;
  };

  add(1, 1, "元日");
  add(1, monday(1, 2), "成人の日");
  add(2, 11, "建国記念の日");
  add(2, 23, "天皇誕生日");
  add(3, springEquinoxDay(year), "春分の日");
  add(4, 29, "昭和の日");
  add(5, 3, "憲法記念日");
  add(5, 4, "みどりの日");
  add(5, 5, "こどもの日");
  add(7, monday(7, 3), "海の日");
  add(8, 11, "山の日");
  add(9, monday(9, 3), "敬老の日");
  add(9, autumnEquinoxDay(year), "秋分の日");
  add(10, monday(10, 2), "スポーツの日");
  add(11, 3, "文化の日");
  add(11, 23, "勤労感謝の日");

  addSubstituteHolidays(year, holidays);
  addCitizensHolidays(year, holidays);
  return holidays;
}

function addSubstituteHolidays(year, holidays) {
  const originals = [...holidays.entries()];
  originals.forEach(([date]) => {
    if (new Date(`${date}T00:00:00`).getDay() !== 0) return;
    let next = addDays(date, 1);
    while (holidays.has(next)) next = addDays(next, 1);
    holidays.set(next, "振替休日");
  });
}

function addCitizensHolidays(year, holidays) {
  for (let month = 1; month <= 12; month += 1) {
    const last = new Date(year, month, 0).getDate();
    for (let day = 2; day < last; day += 1) {
      const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (holidays.has(date)) continue;
      if (holidays.has(addDays(date, -1)) && holidays.has(addDays(date, 1))) {
        holidays.set(date, "国民の休日");
      }
    }
  }
}

function addDays(date, days) {
  const parsed = new Date(`${date}T00:00:00`);
  parsed.setDate(parsed.getDate() + days);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function springEquinoxDay(year) {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function autumnEquinoxDay(year) {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function summaryHtml(items) {
  return items.map(([label, value]) => `<span class="summary-item">${label} ${value}</span>`).join("");
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function escapeHtml(value) {
  return String(value)
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;")
    .split("'").join("&#039;");
}

function exportCsv() {
  const rows = state.users.map((user) => calculateUser(user));
  const lines = [
    ["対象月", "利用者", "出勤日数", "作業時間", "時間工賃", "作業加算", "休日出勤加算", "皆勤手当", "食費控除", "支給額"],
    ...rows.map((row) => [
      state.month,
      row.user.name,
      row.days,
      round(row.hours),
      row.base,
      row.taskPay,
      row.holidayBonus,
      row.perfectBonus,
      row.mealDeduction,
      row.total
    ])
  ];
  const csv = lines.map((line) => line.map(csvCell).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `工賃計算_${state.month}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  return `"${String(value).split('"').join('""')}"`;
}

function printCurrentView() {
  const activeTab = document.querySelector(".tab.active");
  document.body.dataset.printView = activeTab ? activeTab.dataset.tab : "slips";
  window.print();
}

window.addEventListener("beforeprint", () => {
  const activeTab = document.querySelector(".tab.active");
  document.body.dataset.printView = activeTab ? activeTab.dataset.tab : "slips";
});
