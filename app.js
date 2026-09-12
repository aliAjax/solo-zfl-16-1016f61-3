const storageKey = "zfl16-movable-type-workshop";
const storageVersion = 2;

const paperSizes = ["postcard", "bookmark", "square"];
const flowModes = ["horizontal", "vertical"];
const wearLevels = ["新", "微磨", "旧痕"];

function createStarterInventory() {
  return [
    { id: crypto.randomUUID(), char: "山", style: "宋体旧字", size: 30, quantity: 4, wear: "微磨" },
    { id: crypto.randomUUID(), char: "月", style: "宋体旧字", size: 30, quantity: 3, wear: "旧痕" },
    { id: crypto.randomUUID(), char: "风", style: "楷体木刻", size: 28, quantity: 2, wear: "微磨" },
    { id: crypto.randomUUID(), char: "花", style: "楷体木刻", size: 28, quantity: 2, wear: "新" },
    { id: crypto.randomUUID(), char: "茶", style: "黑体铅字", size: 24, quantity: 3, wear: "旧痕" },
    { id: crypto.randomUUID(), char: "雨", style: "仿宋细字", size: 22, quantity: 4, wear: "新" }
  ];
}

function defaultSettings() {
  return {
    paperSize: "postcard",
    flowMode: "horizontal",
    gridGap: 8,
    workTitle: "晚风小笺"
  };
}

function createLayout(name = "版面1") {
  const inventory = createStarterInventory();
  return {
    id: crypto.randomUUID(),
    name,
    inventory,
    selectedTypeId: inventory[0].id,
    placements: [],
    drafts: [],
    settings: defaultSettings()
  };
}

function createProject(name = "项目1") {
  const layout = createLayout("版面1");
  return {
    id: crypto.randomUUID(),
    name,
    layouts: [layout],
    activeLayoutId: layout.id
  };
}

function createDefaultRoot() {
  const project = createProject("项目1");
  return {
    version: storageVersion,
    projects: [project],
    activeProjectId: project.id
  };
}

function sanitizeType(raw) {
  if (!raw || typeof raw !== "object") return null;
  const char = String(raw.char ?? "").trim();
  const style = String(raw.style ?? "").trim();
  if (!char || !style) return null;
  const size = Number(raw.size);
  const quantity = Number(raw.quantity);
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
    char,
    style,
    size: Number.isFinite(size) ? Math.min(72, Math.max(8, size)) : 24,
    quantity: Number.isFinite(quantity) ? Math.min(99, Math.max(1, Math.round(quantity))) : 1,
    wear: wearLevels.includes(raw.wear) ? raw.wear : "新"
  };
}

function sanitizePlacements(raw, validTypeIds) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      row: Number(item.row),
      col: Number(item.col),
      typeId: String(item.typeId ?? "")
    }))
    .filter(
      (item) =>
        Number.isInteger(item.row) &&
        item.row >= 0 &&
        Number.isInteger(item.col) &&
        item.col >= 0 &&
        validTypeIds.has(item.typeId)
    );
}

function sanitizeSettings(raw) {
  const fallback = defaultSettings();
  if (!raw || typeof raw !== "object") return fallback;
  const gridGap = Number(raw.gridGap);
  return {
    paperSize: paperSizes.includes(raw.paperSize) ? raw.paperSize : fallback.paperSize,
    flowMode: flowModes.includes(raw.flowMode) ? raw.flowMode : fallback.flowMode,
    gridGap: Number.isFinite(gridGap) ? Math.min(18, Math.max(4, Math.round(gridGap))) : fallback.gridGap,
    workTitle: typeof raw.workTitle === "string" ? raw.workTitle : fallback.workTitle
  };
}

function sanitizeLayout(raw, fallbackName) {
  const source = raw && typeof raw === "object" ? raw : {};
  const inventory = Array.isArray(source.inventory)
    ? source.inventory.map(sanitizeType).filter(Boolean)
    : createStarterInventory();
  const validTypeIds = new Set(inventory.map((item) => item.id));
  const selectedTypeId = validTypeIds.has(source.selectedTypeId)
    ? source.selectedTypeId
    : inventory[0]?.id ?? null;
  const drafts = Array.isArray(source.drafts)
    ? source.drafts
        .filter((draft) => draft && typeof draft === "object")
        .map((draft) => ({
          id: typeof draft.id === "string" && draft.id ? draft.id : crypto.randomUUID(),
          title: typeof draft.title === "string" ? draft.title : "未命名作品",
          settings: sanitizeSettings(draft.settings),
          placements: sanitizeDraftPlacements(draft.placements),
          savedAt: typeof draft.savedAt === "string" && !Number.isNaN(Date.parse(draft.savedAt))
            ? draft.savedAt
            : new Date(0).toISOString()
        }))
    : [];
  return {
    id: typeof source.id === "string" && source.id ? source.id : crypto.randomUUID(),
    name: typeof source.name === "string" && source.name.trim() ? source.name.trim() : fallbackName,
    inventory,
    selectedTypeId,
    placements: sanitizePlacements(source.placements, validTypeIds),
    drafts,
    settings: sanitizeSettings(source.settings)
  };
}

// 草稿中的落字是历史快照，保留其 typeId（即使字模已从库中删除）
function sanitizeDraftPlacements(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      row: Number(item.row),
      col: Number(item.col),
      typeId: String(item.typeId ?? "")
    }))
    .filter(
      (item) =>
        Number.isInteger(item.row) && item.row >= 0 &&
        Number.isInteger(item.col) && item.col >= 0 &&
        item.typeId
    );
}

function sanitizeProject(raw, index) {
  const fallbackName = `项目${index + 1}`;
  const source = raw && typeof raw === "object" ? raw : {};
  const name = typeof source.name === "string" && source.name.trim() ? source.name.trim() : fallbackName;
  let layouts;
  if (Array.isArray(source.layouts) && source.layouts.length) {
    layouts = source.layouts.map((layout, layoutIndex) =>
      sanitizeLayout(layout, `版面${layoutIndex + 1}`)
    );
  } else {
    layouts = [createLayout("版面1")];
  }
  const activeLayoutId = layouts.some((layout) => layout.id === source.activeLayoutId)
    ? source.activeLayoutId
    : layouts[0].id;
  return {
    id: typeof source.id === "string" && source.id ? source.id : crypto.randomUUID(),
    name,
    layouts,
    activeLayoutId
  };
}

function sanitizeRoot(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const projects = Array.isArray(source.projects)
    ? source.projects.map((project, index) => sanitizeProject(project, index))
    : [];
  const validRoot = projects.length
    ? { version: storageVersion, projects, activeProjectId: "" }
    : createDefaultRoot();
  if (validRoot.projects.length) {
    validRoot.activeProjectId = validRoot.projects.some(
      (project) => project.id === source.activeProjectId
    )
      ? source.activeProjectId
      : validRoot.projects[0].id;
  }
  return validRoot;
}

function migrateLegacyState(parsed) {
  const layout = sanitizeLayout(
    {
      name: "默认版面",
      inventory: parsed.inventory,
      selectedTypeId: parsed.selectedTypeId,
      placements: parsed.placements,
      drafts: parsed.drafts,
      settings: parsed.settings
    },
    "默认版面"
  );
  const project = {
    id: crypto.randomUUID(),
    name: "项目1",
    layouts: [layout],
    activeLayoutId: layout.id
  };
  return {
    version: storageVersion,
    projects: [project],
    activeProjectId: project.id
  };
}

function loadRoot() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return createDefaultRoot();
  try {
    const parsed = JSON.parse(saved);
    if (parsed && Array.isArray(parsed.projects) && parsed.projects.length) {
      return sanitizeRoot(parsed);
    }
    if (
      parsed &&
      (Array.isArray(parsed.inventory) ||
        Array.isArray(parsed.placements) ||
        Array.isArray(parsed.drafts) ||
        (parsed.settings && typeof parsed.settings === "object"))
    ) {
      return migrateLegacyState(parsed);
    }
    return createDefaultRoot();
  } catch {
    return createDefaultRoot();
  }
}

const root = loadRoot();

function getActiveProject() {
  return root.projects.find((project) => project.id === root.activeProjectId) || root.projects[0];
}

function getActiveLayout() {
  const project = getActiveProject();
  return project.layouts.find((layout) => layout.id === project.activeLayoutId) || project.layouts[0];
}

// state 始终指向当前版面（root 内的嵌套对象），切换版面时重新指向
let state = getActiveLayout();

const els = {
  projectSelect: document.querySelector("#projectSelect"),
  layoutSelect: document.querySelector("#layoutSelect"),
  newProjectBtn: document.querySelector("#newProjectBtn"),
  renameProjectBtn: document.querySelector("#renameProjectBtn"),
  removeProjectBtn: document.querySelector("#removeProjectBtn"),
  newLayoutBtn: document.querySelector("#newLayoutBtn"),
  renameLayoutBtn: document.querySelector("#renameLayoutBtn"),
  removeLayoutBtn: document.querySelector("#removeLayoutBtn"),
  paperSize: document.querySelector("#paperSize"),
  flowMode: document.querySelector("#flowMode"),
  gridGap: document.querySelector("#gridGap"),
  workTitle: document.querySelector("#workTitle"),
  stage: document.querySelector("#stage"),
  typeList: document.querySelector("#typeList"),
  typeForm: document.querySelector("#typeForm"),
  charInput: document.querySelector("#charInput"),
  styleInput: document.querySelector("#styleInput"),
  sizeInput: document.querySelector("#sizeInput"),
  quantityInput: document.querySelector("#quantityInput"),
  wearInput: document.querySelector("#wearInput"),
  inventorySearch: document.querySelector("#inventorySearch"),
  styleFilter: document.querySelector("#styleFilter"),
  selectedTypeLabel: document.querySelector("#selectedTypeLabel"),
  shortageBadge: document.querySelector("#shortageBadge"),
  usageList: document.querySelector("#usageList"),
  draftList: document.querySelector("#draftList"),
  placedCount: document.querySelector("#placedCount"),
  inventoryCount: document.querySelector("#inventoryCount"),
  saveDraftBtn: document.querySelector("#saveDraftBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  clearBoardBtn: document.querySelector("#clearBoardBtn")
};

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(root));
}

function uniqueName(prefix, existing) {
  const used = new Set(existing);
  let n = used.size + 1;
  while (used.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

function enterContext() {
  // 切换项目/版面后，搜索与筛选属于临时 UI 状态，随上下文重置
  els.inventorySearch.value = "";
  els.styleFilter.value = "all";
  renderAll();
}

function renderSwitchers() {
  const project = getActiveProject();
  const projectSig = root.projects.map((item) => `${item.id}:${item.name}`).join("|");
  if (els.projectSelect.dataset.sig !== projectSig) {
    els.projectSelect.innerHTML = root.projects
      .map(
        (item) =>
          `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`
      )
      .join("");
    els.projectSelect.dataset.sig = projectSig;
  }
  els.projectSelect.value = project.id;

  const layoutSig = `${project.id}:${project.layouts
    .map((item) => `${item.id}:${item.name}`)
    .join("|")}`;
  if (els.layoutSelect.dataset.sig !== layoutSig) {
    els.layoutSelect.innerHTML = project.layouts
      .map(
        (item) =>
          `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`
      )
      .join("");
    els.layoutSelect.dataset.sig = layoutSig;
  }
  els.layoutSelect.value = project.activeLayoutId;

  els.removeProjectBtn.disabled = root.projects.length <= 1;
  els.removeLayoutBtn.disabled = project.layouts.length <= 1;
  els.removeProjectBtn.title =
    root.projects.length <= 1 ? "至少保留一个项目" : "移除当前项目";
  els.removeLayoutBtn.title =
    project.layouts.length <= 1 ? "每个项目至少保留一个版面" : "移除当前版面";
}

function getGrid() {
  const size = state.settings.paperSize;
  if (size === "bookmark") return { cols: 7, rows: 18 };
  if (size === "square") return { cols: 12, rows: 12 };
  return { cols: 16, rows: 10 };
}

function placementKey(row, col) {
  return `${row}:${col}`;
}

function getSelectedType() {
  return state.inventory.find((item) => item.id === state.selectedTypeId) || null;
}

function getUsage() {
  return state.placements.reduce((acc, placement) => {
    acc[placement.typeId] = (acc[placement.typeId] || 0) + 1;
    return acc;
  }, {});
}

function renderSettings() {
  els.paperSize.value = state.settings.paperSize;
  els.flowMode.value = state.settings.flowMode;
  els.gridGap.value = state.settings.gridGap;
  els.workTitle.value = state.settings.workTitle;
}

function renderStyleFilter() {
  const current = els.styleFilter.value || "all";
  const styles = [...new Set(state.inventory.map((item) => item.style))].sort((a, b) =>
    a.localeCompare(b, "zh-CN")
  );
  els.styleFilter.innerHTML = `<option value="all">全部风格</option>${styles
    .map((style) => `<option value="${escapeHtml(style)}">${escapeHtml(style)}</option>`)
    .join("")}`;
  els.styleFilter.value = styles.includes(current) ? current : "all";
}

function renderInventory() {
  const keyword = els.inventorySearch.value.trim();
  const style = els.styleFilter.value;
  const usage = getUsage();
  const items = state.inventory.filter((item) => {
    const matchesKeyword = !keyword || `${item.char}${item.style}${item.wear}`.includes(keyword);
    const matchesStyle = style === "all" || item.style === style;
    return matchesKeyword && matchesStyle;
  });

  els.inventoryCount.textContent = `${state.inventory.length}枚字模`;
  els.typeList.innerHTML = items
    .map((item) => {
      const used = usage[item.id] || 0;
      const selected = item.id === state.selectedTypeId ? "selected" : "";
      return `
        <article class="type-card ${selected}" draggable="true" data-type-id="${item.id}">
          <div class="glyph" style="font-size:${Math.min(item.size, 36)}px">${escapeHtml(item.char)}</div>
          <div class="type-meta">
            <strong>${escapeHtml(item.char)} · ${escapeHtml(item.style)}</strong>
            <span>${item.size}px · ${escapeHtml(item.wear)} · 已用${used}/${item.quantity}</span>
          </div>
          <button class="mini-btn" title="删除字模" data-delete-type="${item.id}" type="button">×</button>
        </article>
      `;
    })
    .join("");
}

function renderStage() {
  const { cols, rows } = getGrid();
  const map = new Map(state.placements.map((item) => [placementKey(item.row, item.col), item]));
  els.stage.className = `stage ${state.settings.paperSize}`;
  els.stage.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  els.stage.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  els.stage.style.gap = `${state.settings.gridGap}px`;
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const placement = map.get(placementKey(row, col));
      const type = placement ? state.inventory.find((item) => item.id === placement.typeId) : null;
      const vertical = state.settings.flowMode === "vertical" ? "vertical" : "";
      cells.push(`
        <button class="cell ${type ? "used" : ""} ${vertical}" data-row="${row}" data-col="${col}" type="button" aria-label="第${row + 1}行第${col + 1}列">
          ${type ? escapeHtml(type.char) : ""}
        </button>
      `);
    }
  }
  els.stage.innerHTML = cells.join("");
}

function renderUsage() {
  const usage = getUsage();
  const entries = state.inventory.filter((item) => usage[item.id]);
  els.placedCount.textContent = `${state.placements.length}个落字`;

  const shortages = entries.filter((item) => usage[item.id] > item.quantity);
  els.shortageBadge.textContent = shortages.length ? `${shortages.length}处超量` : "数量充足";
  els.shortageBadge.className = `badge ${shortages.length ? "warn" : "ok"}`;

  const selectedType = getSelectedType();
  els.selectedTypeLabel.textContent = selectedType
    ? `当前：${selectedType.char} · ${selectedType.style}`
    : "未选择字模";

  els.usageList.innerHTML =
    entries
      .map((item) => {
        const used = usage[item.id];
        const warn = used > item.quantity ? "warn" : "";
        return `
          <div class="usage-item ${warn}">
            <strong>${escapeHtml(item.char)} ${escapeHtml(item.style)}</strong>
            <span>${used}/${item.quantity}</span>
          </div>
        `;
      })
      .join("") || `<p class="empty">还没有落字。</p>`;
}

function renderDrafts() {
  els.draftList.innerHTML =
    state.drafts
      .map(
        (draft) => `
          <article class="draft-item">
            <strong>${escapeHtml(draft.title)}</strong>
            <span>${draft.placements.length}个落字 · ${new Date(draft.savedAt).toLocaleString("zh-CN")}</span>
            <div class="draft-actions">
              <button type="button" data-load-draft="${draft.id}">载入</button>
              <button type="button" data-delete-draft="${draft.id}">删除</button>
            </div>
          </article>
        `
      )
      .join("") || `<p class="empty">还没有保存草稿。</p>`;
}

function renderAll() {
  saveState();
  renderSwitchers();
  renderSettings();
  renderStyleFilter();
  renderInventory();
  renderStage();
  renderUsage();
  renderDrafts();
}

function placeType(row, col, typeId = state.selectedTypeId) {
  if (!typeId) return;
  const existingIndex = state.placements.findIndex((item) => item.row === row && item.col === col);
  if (existingIndex >= 0) {
    if (state.placements[existingIndex].typeId === typeId) {
      state.placements.splice(existingIndex, 1);
    } else {
      state.placements[existingIndex].typeId = typeId;
    }
  } else {
    state.placements.push({ row, col, typeId });
  }
  renderAll();
}

function addType(event) {
  event.preventDefault();
  const item = {
    id: crypto.randomUUID(),
    char: els.charInput.value.trim(),
    style: els.styleInput.value.trim(),
    size: Number(els.sizeInput.value),
    quantity: Number(els.quantityInput.value),
    wear: els.wearInput.value
  };
  if (!item.char || !item.style) return;
  state.inventory.unshift(item);
  state.selectedTypeId = item.id;
  els.typeForm.reset();
  els.sizeInput.value = 24;
  els.quantityInput.value = 3;
  renderAll();
}

function saveDraft() {
  const title = state.settings.workTitle.trim() || "未命名作品";
  state.drafts.unshift({
    id: crypto.randomUUID(),
    title,
    settings: structuredClone(state.settings),
    placements: structuredClone(state.placements),
    savedAt: new Date().toISOString()
  });
  state.drafts = state.drafts.slice(0, 8);
  renderAll();
}

function exportPreview() {
  const { cols, rows } = getGrid();
  const cell = state.settings.paperSize === "bookmark" ? 44 : 56;
  const gap = state.settings.gridGap;
  const margin = 48;
  const width = cols * cell + (cols - 1) * gap + margin * 2;
  const height = rows * cell + (rows - 1) * gap + margin * 2 + 70;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fffaf1";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#2f2921";
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 18, width - 36, height - 36);
  ctx.fillStyle = "#22201c";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText(state.settings.workTitle || "未命名作品", margin, 50);
  ctx.font = "bold 30px serif";
  state.placements.forEach((placement) => {
    const type = state.inventory.find((item) => item.id === placement.typeId);
    if (!type) return;
    const x = margin + placement.col * (cell + gap);
    const y = margin + 45 + placement.row * (cell + gap);
    ctx.fillStyle = "#2f2921";
    ctx.fillRect(x, y, cell, cell);
    ctx.fillStyle = "#fff5df";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${Math.min(type.size + 8, 42)}px serif`;
    ctx.fillText(type.char, x + cell / 2, y + cell / 2);
  });
  const link = document.createElement("a");
  link.download = `${state.settings.workTitle || "movable-type"}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ---------- 项目与版面管理 ---------- */

function newProject() {
  const suggested = uniqueName("项目", root.projects.map((project) => project.name));
  const input = prompt("新建项目，输入项目名称：", suggested);
  if (input === null) return;
  const name = input.trim() || suggested;
  const project = createProject(name);
  root.projects.push(project);
  root.activeProjectId = project.id;
  state = project.layouts[0];
  enterContext();
}

function renameProject() {
  const project = getActiveProject();
  const input = prompt("重命名项目：", project.name);
  if (input === null) return;
  const name = input.trim();
  if (name && name !== project.name) {
    project.name = name;
    renderAll();
  }
}

function removeProject() {
  if (root.projects.length <= 1) return;
  const project = getActiveProject();
  const confirmed = window.confirm(
    `确定移除项目「${project.name}」？\n该项目下 ${project.layouts.length} 个版面（含各自的字模库、落字与草稿）将一并删除，且无法恢复。`
  );
  if (!confirmed) return;
  const index = root.projects.findIndex((item) => item.id === project.id);
  root.projects.splice(index, 1);
  const next = root.projects[Math.min(index, root.projects.length - 1)];
  root.activeProjectId = next.id;
  state = next.layouts.find((layout) => layout.id === next.activeLayoutId) || next.layouts[0];
  enterContext();
}

function newLayout() {
  const project = getActiveProject();
  const suggested = uniqueName("版面", project.layouts.map((layout) => layout.name));
  const input = prompt("在当前项目中新建版面，输入版面名称：", suggested);
  if (input === null) return;
  const name = input.trim() || suggested;
  const layout = createLayout(name);
  project.layouts.push(layout);
  project.activeLayoutId = layout.id;
  state = layout;
  enterContext();
}

function renameLayout() {
  const project = getActiveProject();
  const layout = project.layouts.find((item) => item.id === project.activeLayoutId) || project.layouts[0];
  const input = prompt("重命名版面：", layout.name);
  if (input === null) return;
  const name = input.trim();
  if (name && name !== layout.name) {
    layout.name = name;
    renderAll();
  }
}

function removeLayout() {
  const project = getActiveProject();
  if (project.layouts.length <= 1) return;
  const layout = project.layouts.find((item) => item.id === project.activeLayoutId) || project.layouts[0];
  const confirmed = window.confirm(
    `确定移除版面「${layout.name}」？\n该版面的字模库、落字与草稿将一并删除，且无法恢复。`
  );
  if (!confirmed) return;
  const index = project.layouts.findIndex((item) => item.id === layout.id);
  project.layouts.splice(index, 1);
  const next = project.layouts[Math.min(index, project.layouts.length - 1)];
  project.activeLayoutId = next.id;
  state = next;
  enterContext();
}

els.newProjectBtn.addEventListener("click", newProject);
els.renameProjectBtn.addEventListener("click", renameProject);
els.removeProjectBtn.addEventListener("click", removeProject);
els.newLayoutBtn.addEventListener("click", newLayout);
els.renameLayoutBtn.addEventListener("click", renameLayout);
els.removeLayoutBtn.addEventListener("click", removeLayout);

els.projectSelect.addEventListener("change", () => {
  const project = root.projects.find((item) => item.id === els.projectSelect.value);
  if (!project || project.id === root.activeProjectId) return;
  root.activeProjectId = project.id;
  state = project.layouts.find((layout) => layout.id === project.activeLayoutId) || project.layouts[0];
  enterContext();
});

els.layoutSelect.addEventListener("change", () => {
  const project = getActiveProject();
  const layout = project.layouts.find((item) => item.id === els.layoutSelect.value);
  if (!layout || layout.id === project.activeLayoutId) return;
  project.activeLayoutId = layout.id;
  state = layout;
  enterContext();
});

/* ---------- 原有版面交互 ---------- */

els.paperSize.addEventListener("change", () => {
  state.settings.paperSize = els.paperSize.value;
  const { cols, rows } = getGrid();
  state.placements = state.placements.filter((item) => item.row < rows && item.col < cols);
  renderAll();
});

els.flowMode.addEventListener("change", () => {
  state.settings.flowMode = els.flowMode.value;
  renderAll();
});

els.gridGap.addEventListener("input", () => {
  state.settings.gridGap = Number(els.gridGap.value);
  renderAll();
});

els.workTitle.addEventListener("input", () => {
  state.settings.workTitle = els.workTitle.value;
  saveState();
});

els.typeForm.addEventListener("submit", addType);
els.inventorySearch.addEventListener("input", renderInventory);
els.styleFilter.addEventListener("change", renderInventory);
els.saveDraftBtn.addEventListener("click", saveDraft);
els.exportBtn.addEventListener("click", exportPreview);
els.clearBoardBtn.addEventListener("click", () => {
  state.placements = [];
  renderAll();
});

els.typeList.addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-type]");
  if (deleteButton) {
    const typeId = deleteButton.dataset.deleteType;
    state.inventory = state.inventory.filter((item) => item.id !== typeId);
    state.placements = state.placements.filter((item) => item.typeId !== typeId);
    if (state.selectedTypeId === typeId) state.selectedTypeId = state.inventory[0]?.id || null;
    renderAll();
    return;
  }
  const card = event.target.closest("[data-type-id]");
  if (!card) return;
  state.selectedTypeId = card.dataset.typeId;
  renderAll();
});

els.typeList.addEventListener("dragstart", (event) => {
  const card = event.target.closest("[data-type-id]");
  if (!card) return;
  event.dataTransfer.setData("text/plain", card.dataset.typeId);
});

els.stage.addEventListener("dragover", (event) => {
  if (event.target.closest(".cell")) event.preventDefault();
});

els.stage.addEventListener("drop", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  event.preventDefault();
  placeType(Number(cell.dataset.row), Number(cell.dataset.col), event.dataTransfer.getData("text/plain"));
});

els.stage.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  placeType(Number(cell.dataset.row), Number(cell.dataset.col));
});

els.draftList.addEventListener("click", (event) => {
  const loadButton = event.target.closest("[data-load-draft]");
  const deleteButton = event.target.closest("[data-delete-draft]");
  if (loadButton) {
    const draft = state.drafts.find((item) => item.id === loadButton.dataset.loadDraft);
    if (!draft) return;
    state.settings = structuredClone(draft.settings);
    state.placements = structuredClone(draft.placements);
    renderAll();
  }
  if (deleteButton) {
    state.drafts = state.drafts.filter((item) => item.id !== deleteButton.dataset.deleteDraft);
    renderAll();
  }
});

renderAll();
