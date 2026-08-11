(() => {
  const LOCAL_KEY = "personal-expenses-local-v2";
  const TOPICS_KEY = "personal-expenses-topics-v1";
  // Paste the deployed Google Apps Script Web App URL here.
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxTYucEDOqWB3tSc9Ax4RrNDQlLSxfg8ZSwS8ciH_a36aALs_tFql2c21QOJQKi7yA/exec";
  const defaultTopics = ["Food drinks", "Entertainment", "Fuel", "Parking", "Ultility"];
  const $ = (s) => document.querySelector(s);
  const today = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const state = {
    sheetRecords: [],
    localRecords: read(LOCAL_KEY, []),
    topics: read(TOPICS_KEY, defaultTopics),
  };

  $("#date").value = iso(today);
  $("#monthLabel").textContent = today.toLocaleDateString("en-MY", { month: "short", year: "numeric" });

  function read(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function save() {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(state.localRecords));
    localStorage.setItem(TOPICS_KEY, JSON.stringify(state.topics));
  }

  function money(n) {
    return `RM ${Number(n || 0).toFixed(2)}`;
  }

  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quote = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const next = text[i + 1];
      if (quote && ch === "\"" && next === "\"") {
        cell += "\"";
        i += 1;
      } else if (ch === "\"") {
        quote = !quote;
      } else if (!quote && ch === ",") {
        row.push(cell);
        cell = "";
      } else if (!quote && (ch === "\n" || ch === "\r")) {
        if (ch === "\r" && next === "\n") i += 1;
        row.push(cell);
        if (row.some((value) => value.trim())) rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += ch;
      }
    }
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
    return rows;
  }

  function normalizeDate(value) {
    const raw = String(value || "").trim();
    const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
    const match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (match) {
      const year = match[3].length === 2 ? `20${match[3]}` : match[3];
      return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
    }
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    }
    return raw;
  }

  function rowId(row) {
    return [row.date, row.topic, row.others, Number(row.cost).toFixed(2)].join("|");
  }

  function allRecords() { return [...state.sheetRecords, ...state.localRecords]; }

  function renderTopics() {
    const topics = Array.from(new Set([...state.topics, ...allRecords().map((row) => row.topic).filter(Boolean)]));
    $("#topic").innerHTML = topics.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
  }

  function render() {
    const records = allRecords();
    const month = $("#date").value.slice(0, 7) || iso(today).slice(0, 7);
    const monthRows = records.filter((r) => r.date.startsWith(month));
    const total = monthRows.reduce((sum, row) => sum + Number(row.cost), 0);
    $("#monthTotal").textContent = money(total);
    $("#heroTotal").textContent = money(total);
    $("#recordCount").textContent = `${records.length} 笔`;

    const monthly = {};
    records.forEach((row) => {
      const rowMonth = row.date.slice(0, 7);
      if (!rowMonth) return;
      if (!monthly[rowMonth]) monthly[rowMonth] = {};
      monthly[rowMonth][row.topic] = (monthly[rowMonth][row.topic] || 0) + Number(row.cost);
    });
    const months = Object.keys(monthly).sort((a, b) => b.localeCompare(a)).slice(0, 12);
    const categories = Array.from(new Set(state.topics.filter(Boolean)));
    $("#monthlyChart").innerHTML = months.length
      ? months.map((month) => {
        const byTopic = monthly[month];
        const total = Object.values(byTopic).reduce((sum, value) => sum + value, 0);
        const rowsHtml = categories.map((topic) => `<div class="bar-row"><span>${esc(topic)}</span><div class="bar-track"><div class="bar-fill" style="width:${total ? ((byTopic[topic] || 0) / total) * 100 : 0}%"></div></div><span class="bar-value">${money(byTopic[topic] || 0)}</span></div>`).join("");
        return `<div class="month-analysis"><div class="month-analysis-head"><strong>${esc(month)}</strong><span>${money(total)}</span></div>${rowsHtml}</div>`;
      }).join("")
      : `<p class="empty">Google Sheet 还没有可分析的记录。</p>`;

    const rows = [...records].sort((a, b) => b.date.localeCompare(a.date));
    $("#records").innerHTML = rows.length
      ? rows.slice(0, 20).map((r) => `<div class="record"><div><strong>${esc(r.topic)}</strong><small>${esc(r.date)}${r.others ? ` · ${esc(r.others)}` : ""}</small></div><div class="record-actions"><span class="amount">${money(r.cost)}</span><button class="delete-record" data-source="${esc(r.source)}" data-id="${esc(r.id)}" type="button" aria-label="删除这笔记录">删除</button></div></div>`).join("")
      : `<p class="empty">Google Sheet 还没有记录。</p>`;
  }

  async function loadSheetRecords(forceFresh = false) {
    if (!APPS_SCRIPT_URL) {
      $("#status").textContent = "尚未连接 Google Sheet，请先完成 Apps Script 部署。";
      $("#status").className = "status error";
      renderTopics();
      render();
      return;
    }
    try {
      $("#status").textContent = "正在读取 Google Sheet...";
      const url = forceFresh ? `${APPS_SCRIPT_URL}?t=${Date.now()}` : APPS_SCRIPT_URL;
      const response = await fetch(url, { cache: forceFresh ? "no-store" : "default" });
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.records)) throw new Error("Sheet not available");
      state.sheetRecords = result.records.map((row) => ({
        date: normalizeDate(row.date),
        topic: String(row.topic || "").trim(),
        others: String(row.others || "").trim(),
        cost: Number(row.cost),
        row: Number(row.row),
        source: "sheet",
        id: String(row.row),
      })).filter((row) => row.date && row.topic && Number.isFinite(row.cost));
      if (Array.isArray(result.topics) && result.topics.length) {
        state.topics = Array.from(new Set(result.topics.map((topic) => String(topic).trim()).filter(Boolean)));
        save();
      }
      $("#status").textContent = "已读取 Google Sheet。";
      $("#status").className = "status success";
    } catch {
      $("#status").textContent = "暂时读取不到 Google Sheet，会先显示本机记录。";
      $("#status").className = "status error";
    }
    renderTopics();
    render();
  }

  $("#expenseForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const date = $("#date").value;
    const topic = $("#topic").value;
    const others = $("#others").value.trim();
    const cost = Number($("#cost").value);
    if (!date || !topic || !cost || cost < 0) {
      $("#status").textContent = "请填写完整资料。";
      $("#status").className = "status error";
      return;
    }
    try {
      $("#status").textContent = APPS_SCRIPT_URL ? "正在保存到 Google Sheet..." : "已记录在本机模拟。";
      if (APPS_SCRIPT_URL) {
        const response = await fetch(APPS_SCRIPT_URL, { method: "POST", body: JSON.stringify({ date, topic, others, cost }) });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error("save failed");
        await loadSheetRecords();
      } else {
        const record = { date, topic, others, cost, source: "local" };
        record.id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        state.localRecords.push(record);
        save();
        renderTopics();
        render();
      }
      e.target.reset();
      $("#date").value = iso(new Date());
      $("#status").textContent = APPS_SCRIPT_URL ? "已保存到 Google Sheet。" : "已记录在本机模拟。";
      $("#status").className = "status success";
    } catch {
      $("#status").textContent = "保存失败，请检查 Google Apps Script 连接。";
      $("#status").className = "status error";
    }
  });

  $("#records").addEventListener("click", async (event) => {
    const button = event.target.closest(".delete-record");
    if (!button) return;
    if (!confirm("删除这笔个人花费记录？")) return;
    if (button.dataset.source === "sheet" && APPS_SCRIPT_URL) {
      button.disabled = true;
      $("#status").textContent = "正在从 Google Sheet 删除...";
      try {
        const response = await fetch(APPS_SCRIPT_URL, { method: "POST", body: JSON.stringify({ action: "delete", row: Number(button.dataset.id) }) });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error("delete failed");
        await loadSheetRecords();
        $("#status").textContent = "记录已从 Google Sheet 删除。";
      } catch {
        button.disabled = false;
        $("#status").textContent = "删除失败，请检查 Google Apps Script 连接。";
        $("#status").className = "status error";
      }
      return;
    } else {
      state.localRecords = state.localRecords.filter((row) => row.id !== button.dataset.id);
      $("#status").textContent = "已删除本机记录。";
    }
    $("#status").className = "status success";
    save();
    render();
  });

  $("#date").addEventListener("change", render);
  $("#refreshButton").addEventListener("click", async () => {
    const button = $("#refreshButton");
    button.disabled = true;
    button.textContent = "↻ 更新中...";
    await loadSheetRecords(true);
    button.disabled = false;
    button.textContent = "↻ 刷新资料";
  });
  const recordView = $("#recordView");
  const analysisView = $("#analysisView");
  function switchView(view) {
    const analysis = view === "analysis";
    recordView.hidden = analysis;
    analysisView.hidden = !analysis;
    $("#recordButton").classList.toggle("active", !analysis);
    $("#analysisButton").classList.toggle("active", analysis);
  }

  $("#analysisButton").addEventListener("click", () => switchView("analysis"));
  $("#recordButton").addEventListener("click", () => switchView("record"));
  renderTopics();
  render();
  loadSheetRecords();
})();
