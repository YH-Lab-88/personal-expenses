(() => {
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxTYucEDOqWB3tSc9Ax4RrNDQlLSxfg8ZSwS8ciH_a36aALs_tFql2c21QOJQKi7yA/exec";
  const APP_VERSION = "2026.08.20.3";
  const CACHE_KEY = "personal-expenses-sheet-cache-v1";
  const QUEUE_KEY = "personal-expenses-write-queue-v1";
  const DEFAULT_TOPICS = ["Food drinks", "Entertainment", "Fuel", "Parking", "Ultility"];
  const $ = (selector) => document.querySelector(selector);
  const today = new Date();
  const state = { records: [], topics: DEFAULT_TOPICS, queue: [], syncing: false };
  const datePicker = $("#datePicker");
  let calculatorExpression = "";

  const isoDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const displayDate = (date) => `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
  const money = (value) => Number(value || 0).toFixed(2);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

  function readLocal(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }

  function saveLocal() {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ records: state.records, topics: state.topics }));
    localStorage.setItem(QUEUE_KEY, JSON.stringify(state.queue));
  }

  function normalizeDate(value) {
    const raw = String(value || "").trim();
    const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
    const displayMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (displayMatch) {
      const year = displayMatch[3].length === 2 ? `20${displayMatch[3]}` : displayMatch[3];
      return `${year}-${displayMatch[2].padStart(2, "0")}-${displayMatch[1].padStart(2, "0")}`;
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? "" : isoDate(parsed);
  }

  function calculateAmount(value) {
    const expression = String(value || "").trim();
    if (!expression || !/^[\d.\s%()+\-*/]+$/.test(expression)) return null;
    try {
      const result = Function(`"use strict"; return (${expression.replace(/%/g, "/100")})`)();
      return Number.isFinite(result) && result > 0 ? Math.round(result * 100) / 100 : null;
    } catch {
      return null;
    }
  }

  function renderCalculatedTotal() {
    const amount = calculateAmount($("#cost").value);
    $("#calculatedTotal").textContent = amount == null ? "合计 —" : `合计 ${money(amount)}`;
  }

  function renderCalculator() {
    const amount = calculateAmount(calculatorExpression);
    $("#calculatorExpression").textContent = calculatorExpression || "0";
    $("#calculatorResult").textContent = amount == null ? "—" : money(amount);
    renderCalculatedTotal();
  }

  function openCalculator() {
    calculatorExpression = $("#cost").value;
    $("#calculatorModal").hidden = false;
    renderCalculator();
  }

  function closeCalculator() {
    $("#calculatorModal").hidden = true;
  }

  function selectedMonth() {
    return normalizeDate($("#date").value).slice(0, 7) || isoDate(today).slice(0, 7);
  }

  function setStatus(message, type = "") {
    $("#status").textContent = message;
    $("#status").className = `status ${type}`;
  }

  function checkForAppUpdate() {
    if (!/^https?:$/.test(window.location.protocol)) return;

    if ("serviceWorker" in navigator) {
      const appPath = new URL("./", window.location.href).pathname;
      navigator.serviceWorker.getRegistrations()
        .then((registrations) => Promise.all(registrations
          .filter((registration) => new URL(registration.scope).pathname === appPath)
          .map((registration) => registration.unregister())))
        .catch(() => {});
    }

    fetch("./version.json", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((release) => {
        if (!release?.version || release.version === APP_VERSION) return;
        const url = new URL(window.location.href);
        if (url.searchParams.get("app-update") === release.version) return;
        url.searchParams.set("app-update", release.version);
        window.location.replace(url.toString());
      })
      .catch(() => {});
  }

  function renderTopics() {
    $("#topic").innerHTML = state.topics.map((topic) => `<option value="${escapeHtml(topic)}">${escapeHtml(topic)}</option>`).join("");
  }

  function renderFuelParkingSummary(records) {
    const groups = [
      ["Vios", "vios"],
      ["Kawasaki", "kawasaki"],
      ["Yamaha", "yamaha"],
      ["Grab", "grab"],
      ["Parking", null],
    ];
    const totals = Object.fromEntries(groups.map(([label]) => [label, 0]));
    records.forEach((record) => {
      const detail = String(record.others || "").toLowerCase();
      const match = groups.find(([, keyword]) => keyword && detail.includes(keyword));
      totals[match ? match[0] : "Parking"] += record.cost;
    });
    return `<div class="fuel-summary">${groups.map(([label]) => `<div class="fuel-summary-row"><span>${label}</span><span>${money(totals[label])}</span></div>`).join("")}</div>`;
  }

  function renderFoodDrinksSummary(records) {
    const mealPattern = /早餐|午餐|晚餐/;
    const totals = { "正餐": 0, "其他": 0 };
    records.forEach((record) => {
      const detail = String(record.others || "");
      totals[mealPattern.test(detail) ? "正餐" : "其他"] += record.cost;
    });
    return `<div class="fuel-summary">${Object.keys(totals).map((label) => `<div class="fuel-summary-row"><span>${label}</span><span>${money(totals[label])}</span></div>`).join("")}</div>`;
  }

  function render() {
    const month = selectedMonth();
    const monthRecords = state.records.filter((record) => record.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date));
    const total = monthRecords.reduce((sum, record) => sum + record.cost, 0);
    $("#heroTotal").textContent = money(total);
    $("#recordCount").textContent = `${monthRecords.length} 笔`;

    $("#records").innerHTML = monthRecords.length
      ? monthRecords.map((record) => `<div class="record"><span class="record-date">${record.date.slice(8, 10)}-${record.date.slice(5, 7)}</span><span class="record-topic">${escapeHtml(record.topic)}</span><span class="record-others">${escapeHtml(record.others || "—")}</span><span class="amount">${money(record.cost)}</span>${record.pending ? "<span class=\"syncing-record\">同步中</span>" : `<button class="delete-record" data-row="${record.row}" type="button">删除</button>`}</div>`).join("")
      : "<p class=\"empty\">这个月还没有花费记录。</p>";

    const monthMap = {};
    state.records.forEach((record) => {
      const key = record.date.slice(0, 7);
      if (!key) return;
      monthMap[key] ??= {};
      monthMap[key][record.topic] = (monthMap[key][record.topic] || 0) + record.cost;
    });
    const months = Object.keys(monthMap).sort((a, b) => b.localeCompare(a)).slice(0, 12);
    const activeMonth = $("#analysisMonth").value || isoDate(today).slice(0, 7);
    const visibleMonths = months.includes(activeMonth) ? [activeMonth] : [];
    $("#monthlyChart").innerHTML = visibleMonths.length
      ? visibleMonths.map((monthKey) => {
        const categories = monthMap[monthKey];
        const monthTotal = Object.values(categories).reduce((sum, value) => sum + value, 0);
        const sortedTopics = [...state.topics].sort((a, b) => {
          const difference = (categories[a] || 0) - (categories[b] || 0);
          return difference || a.localeCompare(b, "zh-Hans");
        });
        const summaryRows = sortedTopics.map((topic) => {
          const value = categories[topic] || 0;
          return `<div class="bar-row"><span>${escapeHtml(topic)}</span><div class="bar-track"><div class="bar-fill" style="width:${monthTotal ? (value / monthTotal) * 100 : 0}%"></div></div><span class="bar-value">${money(value)}</span></div>`;
        }).join("");
        const detailRows = sortedTopics.map((topic, topicIndex) => {
          const value = categories[topic] || 0;
          const topicRecords = state.records.filter((record) => record.date.startsWith(monthKey) && record.topic === topic)
            .sort((a, b) => b.date.localeCompare(a.date));
          const details = topicRecords
            .map((record) => `<div class="category-detail"><span>${record.date.slice(8, 10)}/${record.date.slice(5, 7)}</span><span>${escapeHtml(record.others || "—")}</span><span class="detail-cost">${money(record.cost)}</span></div>`).join("") || "<span class=\"category-empty\">暂无记录</span>";
          const fuelSummary = topic.toLowerCase() === "fuel parking" ? renderFuelParkingSummary(topicRecords) : "";
          const foodSummary = topic.toLowerCase() === "food drinks" ? renderFoodDrinksSummary(topicRecords) : "";
          const detailId = `details-${monthKey}-${topicIndex}`;
          const detailLabel = topicRecords.length ? `显示明细（${topicRecords.length} 笔）` : "显示明细";
          return `<div class="category-breakdown"><div class="category-breakdown-head"><span>${escapeHtml(topic)}</span><span>${money(value)}</span></div>${fuelSummary}${foodSummary}<button class="detail-toggle" data-detail-target="${detailId}" type="button" aria-expanded="false">${detailLabel}</button><div id="${detailId}" class="category-record-list" hidden>${details}</div></div>`;
        }).join("");
        return `<div class="month-analysis"><div class="month-analysis-head"><strong>${monthKey}</strong><span>${money(monthTotal)}</span></div><div class="analysis-subhead">CATEGORY 总结</div>${summaryRows}<div class="analysis-detail-heading">花费明细</div>${detailRows}</div>`;
      }).join("")
      : "<p class=\"empty\">这个月还没有可分析的记录。</p>";

    const comparisonMonths = [...months].reverse();
    $("#monthlyComparison").innerHTML = comparisonMonths.length
      ? `<table class="comparison-table"><thead><tr><th>月份</th><th>总花费</th>${state.topics.map((topic) => `<th>${escapeHtml(topic)}</th>`).join("")}</tr></thead><tbody>${comparisonMonths.map((monthKey, index) => {
        const previousMonth = comparisonMonths[index - 1];
        const total = Object.values(monthMap[monthKey]).reduce((sum, value) => sum + value, 0);
        const previousTotal = previousMonth ? Object.values(monthMap[previousMonth]).reduce((sum, value) => sum + value, 0) : null;
        const totalTrend = previousTotal == null || total === previousTotal ? "" : total > previousTotal ? '<span class="comparison-trend up">↑</span>' : '<span class="comparison-trend down">↓</span>';
        return `<tr><td>${monthKey}</td><td><span class="comparison-cell"><span class="comparison-value">${money(total)}</span>${totalTrend || "<span></span>"}</span></td>${state.topics.map((topic) => {
          const value = monthMap[monthKey][topic] || 0;
          const previousValue = previousMonth ? monthMap[previousMonth][topic] || 0 : null;
          const trend = previousValue == null || value === previousValue ? "" : value > previousValue ? '<span class="comparison-trend up">↑</span>' : '<span class="comparison-trend down">↓</span>';
          return `<td><span class="comparison-cell"><span class="comparison-value">${money(value)}</span>${trend || "<span></span>"}</span></td>`;
        }).join("")}</tr>`;
      }).join("")}</tbody></table>`
      : "<p class=\"empty\">Google Sheet 还没有可比较的记录。</p>";
  }

  async function getSheetData() {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${APPS_SCRIPT_URL}?t=${Date.now()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Google Sheet 无响应");
      return await response.json();
    } catch {
      return getSheetDataJsonp();
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function getSheetDataJsonp() {
    return new Promise((resolve, reject) => {
      const callback = `personalExpenses${Date.now()}`;
      const script = document.createElement("script");
      const timeout = window.setTimeout(fail, 10000);
      function cleanup() { window.clearTimeout(timeout); delete window[callback]; script.remove(); }
      function fail() { cleanup(); reject(new Error("Google Sheet 无响应")); }
      window[callback] = (payload) => { cleanup(); resolve(payload); };
      script.onerror = fail;
      script.src = `${APPS_SCRIPT_URL}?callback=${callback}&t=${Date.now()}`;
      document.head.appendChild(script);
    });
  }

  async function loadSheetData() {
    setStatus("正在读取 Google Sheet...");
    try {
      const result = await getSheetData();
      if (!result?.ok || !Array.isArray(result.records)) throw new Error("资料格式错误");
      const pendingRecords = state.records.filter((record) => record.pending);
      state.records = result.records.map((record) => ({
        row: Number(record.row),
        date: normalizeDate(record.date),
        topic: String(record.topic || "").trim(),
        others: String(record.others || "").trim(),
        cost: Number(record.cost) || 0,
      })).filter((record) => record.row && record.date && record.topic).concat(pendingRecords);
      state.topics = Array.isArray(result.topics) && result.topics.length
        ? [...new Set(result.topics.map((topic) => String(topic).trim()).filter(Boolean))]
        : DEFAULT_TOPICS;
      renderTopics();
      render();
      saveLocal();
      setStatus("已读取 Google Sheet。", "success");
    } catch (error) {
      renderTopics();
      render();
      setStatus("读取失败，请点击刷新资料再试。", "error");
    }
  }

  async function postSheetData(payload) {
    const response = await fetch(APPS_SCRIPT_URL, { method: "POST", body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error("保存失败");
    return result;
  }

  async function processQueue() {
    if (state.syncing || !state.queue.length) return;
    state.syncing = true;
    while (state.queue.length) {
      const job = state.queue[0];
      try {
        const result = await postSheetData(job.payload);
        const record = state.records.find((item) => item.clientId === job.clientId);
        if (record) { record.pending = false; record.row = Number(result.row) || record.row; }
        state.queue.shift();
        saveLocal();
        render();
      } catch {
        setStatus("已保存在电话，等待网络同步。", "error");
        break;
      }
    }
    state.syncing = false;
    if (!state.queue.length) setStatus("已同步到 Google Sheet。", "success");
  }

  $("#expenseForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const date = normalizeDate($("#date").value);
    const topic = $("#topic").value;
    const cost = calculateAmount($("#cost").value);
    if (!date || !topic || cost == null) return setStatus("金额可输入 12.50+8.90 这类计算式。", "error");
    const clientId = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    state.records.unshift({ clientId, row: 0, date, topic, others: $("#others").value.trim(), cost, pending: true });
    state.queue.push({ clientId, payload: { date, topic, others: $("#others").value.trim(), cost } });
    saveLocal();
    render();
    $("#expenseForm").reset();
    $("#date").value = displayDate(new Date());
    datePicker.value = isoDate(new Date());
    renderCalculatedTotal();
    setStatus("已记录在电话，正在同步...", "success");
    processQueue();
  });

  $("#records").addEventListener("click", async (event) => {
    const button = event.target.closest(".delete-record");
    if (!button || !confirm("删除这笔个人花费记录？")) return;
    button.disabled = true;
    try {
      setStatus("正在删除...");
      await postSheetData({ action: "delete", row: Number(button.dataset.row) });
      await loadSheetData();
      setStatus("记录已删除。", "success");
    } catch {
      button.disabled = false;
      setStatus("删除失败，请稍后再试。", "error");
    }
  });

  function openDatePicker() { typeof datePicker.showPicker === "function" ? datePicker.showPicker() : datePicker.click(); }
  $("#date").addEventListener("click", openDatePicker);
  $("#calendarButton").addEventListener("click", openDatePicker);
  datePicker.addEventListener("change", () => {
    if (!datePicker.value) return;
    const [year, month, day] = datePicker.value.split("-").map(Number);
    $("#date").value = displayDate(new Date(year, month - 1, day));
    render();
  });
  $("#date").addEventListener("change", render);
  $("#analysisMonth").addEventListener("change", render);
  $("#monthlyChart").addEventListener("click", (event) => {
    const button = event.target.closest(".detail-toggle");
    if (!button) return;
    const list = document.getElementById(button.dataset.detailTarget);
    if (!list) return;
    const expanded = list.hidden;
    list.hidden = !expanded;
    button.setAttribute("aria-expanded", String(expanded));
    const count = list.querySelectorAll(".category-detail").length;
    button.textContent = expanded ? "收起明细" : count ? `显示明细（${count} 笔）` : "显示明细";
  });
  $("#cost").addEventListener("input", renderCalculatedTotal);
  $("#calculatorOpen").addEventListener("click", openCalculator);
  $("#calculatorCancel").addEventListener("click", closeCalculator);
  $("#calculatorModal").addEventListener("click", (event) => {
    if (event.target === $("#calculatorModal")) closeCalculator();
  });
  $("#calculatorKeys").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.action === "clear") calculatorExpression = "";
    else if (button.dataset.action === "delete") calculatorExpression = calculatorExpression.slice(0, -1);
    else if (button.dataset.key) calculatorExpression += button.dataset.key;
    renderCalculator();
  });
  $("#calculatorEquals").addEventListener("click", () => {
    const amount = calculateAmount(calculatorExpression);
    if (amount == null) return setStatus("请完成正确的金额计算。", "error");
    $("#cost").value = amount.toFixed(2);
    renderCalculatedTotal();
    closeCalculator();
  });
  $("#refreshButton").addEventListener("click", async () => {
    const button = $("#refreshButton");
    button.disabled = true;
    button.textContent = "↻ 更新中...";
    await loadSheetData();
    processQueue();
    button.disabled = false;
    button.textContent = "↻ 刷新资料";
  });
  $("#analysisButton").addEventListener("click", () => {
    $("#recordView").hidden = true;
    $("#analysisView").hidden = false;
    $("#monthlyComparisonView").hidden = true;
    $("#recordButton").classList.remove("active");
    $("#analysisButton").classList.add("active");
    $("#monthlyButton").classList.remove("active");
  });
  $("#monthlyButton").addEventListener("click", () => {
    $("#recordView").hidden = true;
    $("#analysisView").hidden = true;
    $("#monthlyComparisonView").hidden = false;
    $("#recordButton").classList.remove("active");
    $("#analysisButton").classList.remove("active");
    $("#monthlyButton").classList.add("active");
  });
  $("#recordButton").addEventListener("click", () => {
    $("#recordView").hidden = false;
    $("#analysisView").hidden = true;
    $("#monthlyComparisonView").hidden = true;
    $("#recordButton").classList.add("active");
    $("#analysisButton").classList.remove("active");
    $("#monthlyButton").classList.remove("active");
  });

  $("#date").value = displayDate(today);
  datePicker.value = isoDate(today);
  $("#analysisMonth").value = isoDate(today).slice(0, 7);
  const cached = readLocal(CACHE_KEY, {});
  state.records = Array.isArray(cached.records) ? cached.records : [];
  state.topics = Array.isArray(cached.topics) && cached.topics.length ? cached.topics : DEFAULT_TOPICS;
  state.queue = readLocal(QUEUE_KEY, []);
  checkForAppUpdate();
  renderTopics();
  renderCalculatedTotal();
  render();
  loadSheetData();
  processQueue();
  window.addEventListener("online", processQueue);
})();
