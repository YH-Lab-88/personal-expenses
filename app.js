(() => {
  const LOCAL_KEY = "personal-expenses-local-v2";
  const HIDDEN_KEY = "personal-expenses-hidden-sheet-v1";
  const TOPICS_KEY = "personal-expenses-topics-v1";
  const SHEET_ID = "1Dcog-g4Epq5qprE3iHC7p_QFOYLKdbMC2Lh2fs3IFEo";
  const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=0`;
  const defaultTopics = ["Food drinks", "Entertainment", "Fuel", "Parking", "Ultility"];
  const $ = (s) => document.querySelector(s);
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const state = {
    sheetRecords: [],
    localRecords: read(LOCAL_KEY, []),
    hiddenSheetRecords: read(HIDDEN_KEY, []),
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
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(state.hiddenSheetRecords));
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
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return iso(parsed);
    const match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (!match) return raw;
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }

  function rowId(row) {
    return [row.date, row.topic, row.others, Number(row.cost).toFixed(2)].join("|");
  }

  function allRecords() {
    const hidden = new Set(state.hiddenSheetRecords);
    return [
      ...state.sheetRecords.filter((row) => !hidden.has(row.id)),
      ...state.localRecords,
    ];
  }

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
      if (rowMonth) monthly[rowMonth] = (monthly[rowMonth] || 0) + Number(row.cost);
    });
    const entries = Object.entries(monthly).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
    const max = Math.max(...entries.map((entry) => entry[1]), 1);
    $("#monthlyChart").innerHTML = entries.length
      ? entries.map(([m, v]) => `<div class="bar-row"><span>${m}</span><div class="bar-track"><div class="bar-fill" style="width:${(v / max) * 100}%"></div></div><span class="bar-value">${money(v)}</span></div>`).join("")
      : `<p class="empty">Google Sheet 还没有可分析的记录。</p>`;

    const rows = [...records].sort((a, b) => b.date.localeCompare(a.date));
    $("#records").innerHTML = rows.length
      ? rows.slice(0, 20).map((r) => `<div class="record"><div><strong>${esc(r.topic)}</strong><small>${esc(r.date)}${r.others ? ` · ${esc(r.others)}` : ""}</small></div><div class="record-actions"><span class="amount">${money(r.cost)}</span><button class="delete-record" data-source="${esc(r.source)}" data-id="${esc(r.id)}" type="button" aria-label="删除这笔记录">删除</button></div></div>`).join("")
      : `<p class="empty">Google Sheet 还没有记录。</p>`;
  }

  async function loadSheetRecords() {
    $("#status").textContent = "正在读取 Google Sheet...";
    try {
      const response = await fetch(SHEET_CSV_URL, { cache: "no-store" });
      if (!response.ok) throw new Error("Sheet not available");
      const rows = parseCsv(await response.text()).slice(1);
      state.sheetRecords = rows.map((row) => {
        const hasOthers = row.length >= 4;
        const record = {
          date: normalizeDate(row[0]),
          topic: String(row[1] || "").trim(),
          others: hasOthers ? String(row[2] || "").trim() : "",
          cost: Number(String(hasOthers ? row[3] : row[2]).replace(/[^\d.-]/g, "")),
          source: "sheet",
        };
        record.id = rowId(record);
        return record;
      }).filter((row) => row.date && row.topic && Number.isFinite(row.cost));
      $("#status").textContent = "已读取 Google Sheet。";
      $("#status").className = "status success";
    } catch {
      $("#status").textContent = "暂时读取不到 Google Sheet，会先显示本机记录。";
      $("#status").className = "status error";
    }
    renderTopics();
    render();
  }

  $("#expenseForm").addEventListener("submit", (e) => {
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
    const record = { date, topic, others, cost, source: "local" };
    record.id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    state.localRecords.push(record);
    save();
    e.target.reset();
    $("#date").value = iso(new Date());
    $("#status").textContent = "已记录在本机模拟。";
    $("#status").className = "status success";
    renderTopics();
    render();
  });

  $("#records").addEventListener("click", (event) => {
    const button = event.target.closest(".delete-record");
    if (!button) return;
    if (!confirm("删除这笔个人花费记录？")) return;
    if (button.dataset.source === "sheet") {
      state.hiddenSheetRecords.push(button.dataset.id);
      $("#status").textContent = "已从 APP 画面移除。Google Sheet 原资料不会被改动。";
    } else {
      state.localRecords = state.localRecords.filter((row) => row.id !== button.dataset.id);
      $("#status").textContent = "已删除本机记录。";
    }
    $("#status").className = "status success";
    save();
    render();
  });

  $("#date").addEventListener("change", render);
  $("#reset").addEventListener("click", () => {
    if (confirm("清除本机新增和隐藏记录？")) {
      state.localRecords = [];
      state.hiddenSheetRecords = [];
      save();
      render();
      loadSheetRecords();
    }
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
