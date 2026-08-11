(() => {
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxTYucEDOqWB3tSc9Ax4RrNDQlLSxfg8ZSwS8ciH_a36aALs_tFql2c21QOJQKi7yA/exec";
  const DEFAULT_TOPICS = ["Food drinks", "Entertainment", "Fuel", "Parking", "Ultility"];
  const $ = (selector) => document.querySelector(selector);
  const today = new Date();
  const state = { records: [], topics: DEFAULT_TOPICS };
  const datePicker = $("#datePicker");

  const isoDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const displayDate = (date) => `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
  const money = (value) => Number(value || 0).toFixed(2);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

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

  function selectedMonth() {
    return normalizeDate($("#date").value).slice(0, 7) || isoDate(today).slice(0, 7);
  }

  function setStatus(message, type = "") {
    $("#status").textContent = message;
    $("#status").className = `status ${type}`;
  }

  function renderTopics() {
    $("#topic").innerHTML = state.topics.map((topic) => `<option value="${escapeHtml(topic)}">${escapeHtml(topic)}</option>`).join("");
  }

  function render() {
    const month = selectedMonth();
    const monthRecords = state.records.filter((record) => record.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date));
    const total = monthRecords.reduce((sum, record) => sum + record.cost, 0);
    $("#heroTotal").textContent = money(total);
    $("#recordCount").textContent = `${monthRecords.length} 笔`;

    $("#records").innerHTML = monthRecords.length
      ? monthRecords.map((record) => `<div class="record"><span class="record-date">${record.date.slice(8, 10)}-${record.date.slice(5, 7)}</span><span class="record-topic">${escapeHtml(record.topic)}</span><span class="record-others">${escapeHtml(record.others || "—")}</span><span class="amount">${money(record.cost)}</span><button class="delete-record" data-row="${record.row}" type="button">删除</button></div>`).join("")
      : "<p class=\"empty\">这个月还没有花费记录。</p>";

    const monthMap = {};
    state.records.forEach((record) => {
      const key = record.date.slice(0, 7);
      if (!key) return;
      monthMap[key] ??= {};
      monthMap[key][record.topic] = (monthMap[key][record.topic] || 0) + record.cost;
    });
    const months = Object.keys(monthMap).sort((a, b) => b.localeCompare(a)).slice(0, 12);
    $("#monthlyChart").innerHTML = months.length
      ? months.map((monthKey) => {
        const categories = monthMap[monthKey];
        const monthTotal = Object.values(categories).reduce((sum, value) => sum + value, 0);
        const rows = state.topics.map((topic) => {
          const value = categories[topic] || 0;
          return `<div class="bar-row"><span>${escapeHtml(topic)}</span><div class="bar-track"><div class="bar-fill" style="width:${monthTotal ? (value / monthTotal) * 100 : 0}%"></div></div><span class="bar-value">${money(value)}</span></div>`;
        }).join("");
        return `<div class="month-analysis"><div class="month-analysis-head"><strong>${monthKey}</strong><span>${money(monthTotal)}</span></div>${rows}</div>`;
      }).join("")
      : "<p class=\"empty\">Google Sheet 还没有可分析的记录。</p>";
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
      state.records = result.records.map((record) => ({
        row: Number(record.row),
        date: normalizeDate(record.date),
        topic: String(record.topic || "").trim(),
        others: String(record.others || "").trim(),
        cost: Number(record.cost) || 0,
      })).filter((record) => record.row && record.date && record.topic);
      state.topics = Array.isArray(result.topics) && result.topics.length
        ? [...new Set(result.topics.map((topic) => String(topic).trim()).filter(Boolean))]
        : DEFAULT_TOPICS;
      renderTopics();
      render();
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
  }

  $("#expenseForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const date = normalizeDate($("#date").value);
    const topic = $("#topic").value;
    const cost = Number($("#cost").value);
    if (!date || !topic || !Number.isFinite(cost) || cost <= 0) return setStatus("请填写日期、课题和金额。", "error");
    try {
      setStatus("正在保存到 Google Sheet...");
      await postSheetData({ date, topic, others: $("#others").value.trim(), cost });
      $("#expenseForm").reset();
      $("#date").value = displayDate(new Date());
      datePicker.value = isoDate(new Date());
      await loadSheetData();
      setStatus("已保存到 Google Sheet。", "success");
    } catch {
      setStatus("保存失败，请稍后再试。", "error");
    }
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
  $("#refreshButton").addEventListener("click", async () => {
    const button = $("#refreshButton");
    button.disabled = true;
    button.textContent = "↻ 更新中...";
    await loadSheetData();
    button.disabled = false;
    button.textContent = "↻ 刷新资料";
  });
  $("#analysisButton").addEventListener("click", () => {
    $("#recordView").hidden = true;
    $("#analysisView").hidden = false;
    $("#recordButton").classList.remove("active");
    $("#analysisButton").classList.add("active");
  });
  $("#recordButton").addEventListener("click", () => {
    $("#recordView").hidden = false;
    $("#analysisView").hidden = true;
    $("#recordButton").classList.add("active");
    $("#analysisButton").classList.remove("active");
  });

  $("#date").value = displayDate(today);
  datePicker.value = isoDate(today);
  renderTopics();
  render();
  loadSheetData();
})();
