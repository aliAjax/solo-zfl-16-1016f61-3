#!/usr/bin/env node
/**
 * 活字排版工坊 —— 多项目 / 多版面回归测试
 *
 * 用法：  node test/regression.js
 *
 * 纯 Node 内置模块运行（vm 桩掉 localStorage / document / prompt / confirm），
 * 不需要浏览器、点击页面或外部服务。每个用例都在全新沙箱中加载真实的 app.js，
 * 用同一 localStorage 重新执行脚本来模拟「刷新」。
 *
 * 退出码：0 全部通过；1 存在失败（可接入 CI / pre-commit）。
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP_PATH = path.join(__dirname, "..", "app.js");
const APP_CODE = fs.readFileSync(APP_PATH, "utf8");
const STORAGE_KEY = "zfl16-movable-type-workshop";

/* ------------------------------------------------------------------ */
/* 测试框架                                                             */
/* ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, message) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(message);
    console.log(`  ✗ ${message}`);
  }
}

function eq(actual, expected, message) {
  const equal = actual === expected;
  if (!equal) console.log(`  ✗ ${message}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`);
  ok(equal, message);
}

function section(name) {
  console.log(`\n■ ${name}`);
}

/* ------------------------------------------------------------------ */
/* 浏览器环境桩                                                         */
/* ------------------------------------------------------------------ */

function makeStorage() {
  const data = new Map();
  return {
    raw: data,
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    }
  };
}

function makeElement() {
  return {
    value: "",
    textContent: "",
    innerHTML: "",
    className: "",
    style: {},
    dataset: {},
    disabled: false,
    title: "",
    files: null,
    _listeners: {},
    reset() {},
    addEventListener(type, handler) {
      this._listeners[type] = handler;
    },
    fire(type, event) {
      const handler = this._listeners[type];
      if (handler) handler(event || {});
    },
    click() {
      this.fire("click");
    }
  };
}

class BlobStub {
  constructor(parts = []) {
    this._text = parts.map((part) => String(part)).join("");
  }
}

class FileReaderStub {
  constructor() {
    this.result = null;
    this.onload = null;
    this.onerror = null;
  }
  readAsText(file) {
    Promise.resolve().then(() => {
      if (file && file.__readError) {
        if (this.onerror) this.onerror();
      } else {
        this.result = file && file.__text != null ? file.__text : "";
        if (this.onload) this.onload();
      }
    });
  }
}

function makeDocument() {
  const elements = new Map();
  const downloads = [];
  const get = (selector) => {
    if (!elements.has(selector)) elements.set(selector, makeElement());
    return elements.get(selector);
  };
  // canvas 2D 上下文：所有方法都是空函数，所有属性可赋值
  const ctx2d = new Proxy(
    {},
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        return typeof prop === "string" ? () => {} : undefined;
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      }
    }
  );
  return {
    get,
    document: {
      querySelector: (selector) => get(selector),
      createElement(tag) {
        if (tag === "canvas") {
          return { width: 0, height: 0, getContext: () => ctx2d, toDataURL: () => "data:image/png;base64,AAA=" };
        }
        if (tag === "a") {
          return {
            click() {
              downloads.push({ href: this.href, download: this.download });
            },
            download: "",
            href: ""
          };
        }
        return { click() {}, download: "", href: "" };
      }
    },
    downloads
  };
}

/**
 * 在新 vm 沙箱中加载 app.js。
 * @param {object} storage  makeStorage() 返回的存储（跨「刷新」需复用同一对象）
 * @param {object} dialogs  { prompt: 函数|null, confirm: 函数|null }
 */
function boot(storage, dialogs = {}) {
  const { get, document, downloads } = makeDocument();
  const dialog = {
    promptImpl: typeof dialogs.prompt === "function" ? dialogs.prompt : null,
    confirmImpl: typeof dialogs.confirm === "function" ? dialogs.confirm : null,
    confirmCalls: 0,
    lastConfirmMessage: null,
    alerts: []
  };

  const sandbox = {
    console,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Math,
    Date,
    Set,
    Map,
    Promise,
    setTimeout,
    clearTimeout,
    structuredClone,
    crypto,
    localStorage: storage,
    document,
    Blob: BlobStub,
    URL: { createObjectURL: () => "blob:stub", revokeObjectURL: () => {} },
    FileReader: FileReaderStub,
    prompt: (message, def) => (dialog.promptImpl ? dialog.promptImpl(message, def) : null),
    confirm: (message) => {
      dialog.confirmCalls += 1;
      dialog.lastConfirmMessage = message;
      return dialog.confirmImpl ? dialog.confirmImpl(message) : false;
    },
    alert: (message) => {
      dialog.alerts.push(String(message));
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  // 与 app.js 同一脚本作用域内导出内部 API（顶层 const/let 不会挂到 vm 全局对象）
  const exportApi = `
    ;globalThis.__api = {
      getRoot: () => root,
      getState: () => state,
      getActiveProject,
      getActiveLayout,
      placeType,
      newProject,
      renameProject,
      removeProject,
      newLayout,
      renameLayout,
      removeLayout,
      saveDraft,
      exportPreview,
      exportBackup,
      buildBackup,
      importBackupText,
      applyBackup,
      handleImportFile,
      renderAll
    };
  `;
  vm.runInContext(APP_CODE + exportApi, sandbox, { filename: "app.js" });

  const api = sandbox.__api;
  const el = (selector) => get(selector);
  const selectProject = (id) => {
    const node = el("#projectSelect");
    node.value = id;
    node.fire("change");
  };
  const selectLayout = (id) => {
    const node = el("#layoutSelect");
    node.value = id;
    node.fire("change");
  };
  // 模拟用户通过文件输入选择文件并等待 FileReader 的异步 onload
  const chooseBackupFile = async (file) => {
    const input = el("#backupFileInput");
    input.files = file ? [file] : null;
    input.fire("change");
    await Promise.resolve();
    await Promise.resolve();
  };
  return { api, el, dialog, selectProject, selectLayout, storage, downloads, chooseBackupFile };
}

/* ------------------------------------------------------------------ */
/* 测试辅助                                                             */
/* ------------------------------------------------------------------ */

function addType(api, el, fields = {}) {
  el("#charInput").value = fields.char || "竹";
  el("#styleInput").value = fields.style || "手写体";
  el("#sizeInput").value = String(fields.size || 24);
  el("#quantityInput").value = String(fields.quantity || 3);
  el("#wearInput").value = fields.wear || "新";
  el("#typeForm").fire("submit", { preventDefault() {} });
}

function setSetting(el, selector, value, eventType = "change") {
  el(selector).value = value;
  el(selector).fire(eventType);
}

function snapshot(root) {
  // 序列化再反序列化，得到与刷新后等价的纯数据
  return JSON.parse(JSON.stringify(root));
}

function persistCount(storage) {
  return JSON.parse(storage.getItem(STORAGE_KEY));
}

/* ------------------------------------------------------------------ */
/* 1. 初始状态与保底数量                                                 */
/* ------------------------------------------------------------------ */

section("初始状态：至少保留一个项目和一个版面");
{
  const env = boot(makeStorage());
  const { api, el } = env;
  eq(api.getRoot().projects.length, 1, "首次打开只有 1 个项目");
  eq(api.getActiveProject().layouts.length, 1, "项目下只有 1 个版面");
  eq(el("#removeProjectBtn").disabled, true, "唯一项目的「移除」按钮禁用");
  eq(el("#removeLayoutBtn").disabled, true, "唯一版面的「移除」按钮禁用");
  ok(api.getState().inventory.length === 6, "新版面自带示例字模库");
  ok(Array.isArray(api.getState().placements) && api.getState().placements.length === 0, "新版面落字为空");
  ok(Array.isArray(api.getState().drafts) && api.getState().drafts.length === 0, "新版面草稿为空");
}

/* ------------------------------------------------------------------ */
/* 2. 项目：新建 / 切换 / 重命名 / 移除                                   */
/* ------------------------------------------------------------------ */

section("项目：新建、切换、重命名、移除");
{
  const storage = makeStorage();
  let env = boot(storage, { prompt: () => "诗集项目" });
  const { api, el, dialog } = env;

  api.newProject();
  eq(api.getRoot().projects.length, 2, "新建后有 2 个项目");
  eq(api.getActiveProject().name, "诗集项目", "新建后自动切换到新项目");
  eq(el("#projectSelect").value, api.getActiveProject().id, "项目下拉指向新项目");

  // 新项目自带一个版面，且是独立数据
  eq(api.getActiveProject().layouts.length, 1, "新项目自带 1 个版面");
  eq(api.getState().inventory.length, 6, "新项目字模库是独立的初始库");
  eq(api.getState().placements.length, 0, "新项目看不到旧项目的落字");

  // 切换回项目1
  const firstId = api.getRoot().projects[0].id;
  env.selectProject(firstId);
  eq(api.getActiveProject().name, "项目1", "下拉切换回项目1");

  // 重命名
  env.dialog.promptImpl = () => "改名后的项目";
  api.renameProject();
  eq(api.getActiveProject().name, "改名后的项目", "项目重命名生效");
  const persisted = persistCount(storage);
  ok(persisted.projects.some((p) => p.name === "改名后的项目"), "重命名已写入本地存储");

  // 重命名取消 / 空白名不改
  env.dialog.promptImpl = () => null;
  api.renameProject();
  eq(api.getActiveProject().name, "改名后的项目", "取消重命名时原名保留");
  env.dialog.promptImpl = () => "   ";
  api.renameProject();
  eq(api.getActiveProject().name, "改名后的项目", "空白名不会覆盖原名");

  // 移除：取消则保留（保护：不能绕过确认）
  const secondId = api.getRoot().projects[1].id;
  env.selectProject(secondId);
  dialog.confirmImpl = () => false;
  api.removeProject();
  eq(dialog.confirmCalls, 1, "移除项目前必须弹确认框");
  eq(api.getRoot().projects.length, 2, "确认框取消，项目不被移除");
  ok(/诗集项目/.test(dialog.lastConfirmMessage || ""), "确认文案包含项目名称");

  // 移除：确认后删除并自动切走
  dialog.confirmImpl = () => true;
  api.removeProject();
  eq(api.getRoot().projects.length, 1, "确认后项目被移除");
  eq(api.getActiveProject().name, "改名后的项目", "移除当前项目后自动切到剩余项目");
}

/* ------------------------------------------------------------------ */
/* 3. 绕过移除保护的尝试                                                  */
/* ------------------------------------------------------------------ */

section("保护：无法移除最后一个项目 / 版面");
{
  const env = boot(makeStorage(), { confirm: () => true });
  const { api, dialog } = env;

  // 即使确认框返回「确定」，最后一个项目也不能被删掉
  dialog.confirmCalls = 0;
  let projectThrew = false;
  try {
    api.removeProject();
  } catch (err) {
    projectThrew = true;
  }
  eq(projectThrew, false, "移除最后一个项目被安全拦截，不抛错");
  eq(api.getRoot().projects.length, 1, "强行调用也不能移除最后一个项目");
  eq(dialog.confirmCalls, 0, "最后一个项目不弹确认框（直接拦截）");

  dialog.confirmCalls = 0;
  let layoutThrew = false;
  try {
    api.removeLayout();
  } catch (err) {
    layoutThrew = true;
  }
  eq(layoutThrew, false, "移除最后一个版面被安全拦截，不抛错");
  eq(api.getActiveProject().layouts.length, 1, "强行调用也不能移除最后一个版面");
  eq(dialog.confirmCalls, 0, "最后一个版面不弹确认框（直接拦截）");
}

/* ------------------------------------------------------------------ */
/* 4. 版面：新建 / 切换 / 重命名 / 移除                                   */
/* ------------------------------------------------------------------ */

section("版面：新建、切换、重命名、移除");
{
  const storage = makeStorage();
  const env = boot(storage, { prompt: () => "春之卷" });
  const { api, el, dialog } = env;
  const project = () => api.getActiveProject();

  api.newLayout();
  eq(project().layouts.length, 2, "新建后项目下有 2 个版面");
  eq(project().activeLayoutId, project().layouts[1].id, "新建后自动切换到新版面");
  eq(el("#layoutSelect").value, project().activeLayoutId, "版面下拉指向新版面");

  // 切回版面1
  const layout1Id = project().layouts[0].id;
  env.selectLayout(layout1Id);
  eq(api.getActiveLayout().id, layout1Id, "下拉切换回版面1");

  // 重命名
  env.dialog.promptImpl = () => "夏之卷";
  api.renameLayout();
  eq(project().layouts[0].name, "夏之卷", "版面重命名生效");
  env.dialog.promptImpl = () => null;
  api.renameLayout();
  eq(project().layouts[0].name, "夏之卷", "取消重命名时原名保留");

  // 移除当前（第二个）版面：取消 → 确认
  const layout2Id = project().layouts[1].id;
  env.selectLayout(layout2Id);
  dialog.confirmImpl = () => false;
  api.removeLayout();
  eq(project().layouts.length, 2, "取消移除，版面保留");
  dialog.confirmImpl = () => true;
  api.removeLayout();
  eq(project().layouts.length, 1, "确认后版面被移除");
  eq(project().layouts[0].name, "夏之卷", "移除后自动切回剩余版面");
  ok(persistCount(storage).projects[0].layouts.length === 1, "版面移除已写入本地存储");
}

/* ------------------------------------------------------------------ */
/* 5. 同项目内多版面：字模 / 落字 / 草稿 / 设置互不串数据                  */
/* ------------------------------------------------------------------ */

section("版面隔离：字模、落字、草稿、设置不串数据");
{
  const env = boot(makeStorage(), { prompt: () => "版面B" });
  const { api, el } = env;

  // —— 在版面 A 制造数据 ——
  addType(api, el, { char: "竹", style: "手写体" });
  const bamboo = api.getState().inventory.find((t) => t.char === "竹");
  api.getState().selectedTypeId = bamboo.id;
  api.placeType(0, 0);
  api.placeType(0, 1);
  setSetting(el, "#workTitle", "A版面标题");
  el("#workTitle").fire("input");
  setSetting(el, "#paperSize", "square");
  setSetting(el, "#flowMode", "vertical");
  el("#gridGap").value = "16";
  el("#gridGap").fire("input");
  api.saveDraft();

  const layoutA = api.getActiveLayout();
  ok(layoutA.placements.length === 2, "版面A 落 2 字");
  ok(layoutA.drafts.length === 1, "版面A 有 1 份草稿");
  eq(layoutA.settings.workTitle, "A版面标题", "版面A 标题已设置");

  // —— 新建并切到版面 B ——
  api.newLayout();
  const layoutBId = api.getActiveLayout().id;
  ok(layoutBId !== layoutA.id, "确实切换到了新版面");
  ok(!api.getState().inventory.some((t) => t.char === "竹"), "版面B 看不到版面A 的自定义字模");
  eq(api.getState().placements.length, 0, "版面B 看不到版面A 的落字");
  eq(api.getState().drafts.length, 0, "版面B 看不到版面A 的草稿");
  eq(api.getState().settings.workTitle, "晚风小笺", "版面B 是默认标题，不串版面A 设置");
  eq(api.getState().settings.paperSize, "postcard", "版面B 是默认纸张");
  eq(api.getState().settings.flowMode, "horizontal", "版面B 是默认方向");
  eq(api.getState().settings.gridGap, 8, "版面B 是默认网格间距");

  // 在 B 放不同的数据
  const mountain = api.getState().inventory.find((t) => t.char === "山");
  api.getState().selectedTypeId = mountain.id;
  api.placeType(5, 5);
  setSetting(el, "#workTitle", "B版面标题");
  el("#workTitle").fire("input");
  api.saveDraft();

  // —— 切回 A：原数据完整（未保存内容不被清空）——
  env.selectLayout(layoutA.id);
  ok(api.getState().inventory.some((t) => t.char === "竹"), "切回A：自定义字模仍在");
  eq(api.getState().placements.length, 2, "切回A：2 个落字仍在");
  eq(api.getState().drafts.length, 1, "切回A：草稿仍在");
  eq(api.getState().settings.workTitle, "A版面标题", "切回A：标题设置仍在");
  eq(api.getState().settings.paperSize, "square", "切回A：纸张设置仍在");
  eq(api.getState().settings.flowMode, "vertical", "切回A：方向设置仍在");
  eq(api.getState().settings.gridGap, 16, "切回A：网格设置仍在");

  // —— 再切到 B：B 的数据也没被 A 覆盖 ——
  env.selectLayout(layoutBId);
  eq(api.getState().placements.length, 1, "再切B：B 的 1 个落字仍在");
  eq(api.getState().drafts.length, 1, "再切B：B 的草稿仍在");
  eq(api.getState().settings.workTitle, "B版面标题", "再切B：B 的标题仍在");
  ok(!api.getState().inventory.some((t) => t.char === "竹"), "再切B：A 的字模没有泄漏过来");

  // 深隔离：拿到存储里的两个版面，互相之间不能共享任何对象引用
  const root = persistCount(env.storage);
  const proj = root.projects[0];
  const [a, b] = proj.layouts;
  ok(a.inventory !== b.inventory && a.placements !== b.placements, "存储中两版面的字模/落字数组彼此独立");
  ok(a.drafts !== b.drafts && a.settings !== b.settings, "存储中两版面的草稿/设置对象彼此独立");
  ok(a.inventory[0] !== b.inventory[0], "即使是同内容的示例字模，也是各自独立的对象");
}

/* ------------------------------------------------------------------ */
/* 6. 跨项目隔离                                                         */
/* ------------------------------------------------------------------ */

section("项目隔离：项目之间版面与数据完全独立");
{
  const env = boot(makeStorage(), { prompt: () => "项目二" });
  const { api } = env;

  // 项目1 / 版面1 放数据
  addType(api, env.el, { char: "墨", style: "金文体" });
  const ink = api.getState().inventory.find((t) => t.char === "墨");
  api.getState().selectedTypeId = ink.id;
  api.placeType(1, 1);
  api.saveDraft();

  // 新建项目二（自带独立版面）
  api.newLayout(); // 先在项目1里加第二个版面，验证它不会被带到项目二
  api.newProject();
  eq(api.getRoot().projects.length, 2, "存在 2 个项目");
  eq(api.getActiveProject().layouts.length, 1, "新项目只有自己的 1 个版面（看不到旧项目的版面）");
  ok(!api.getState().inventory.some((t) => t.char === "墨"), "新项目看不到旧项目的字模");
  eq(api.getState().placements.length, 0, "新项目看不到旧项目的落字");
  eq(api.getState().drafts.length, 0, "新项目看不到旧项目的草稿");

  // 在项目二落字
  const wind = api.getState().inventory.find((t) => t.char === "风");
  api.getState().selectedTypeId = wind.id;
  api.placeType(2, 2);

  // 切回项目一（注意：之前新建版面2 后，项目一的活动版面停留在版面2，需显式选回版面1）
  const p1 = api.getRoot().projects[0];
  env.selectProject(p1.id);
  env.selectLayout(p1.layouts[0].id);
  eq(api.getActiveProject().layouts.length, 2, "项目一仍有自己的 2 个版面");
  ok(api.getState().inventory.some((t) => t.char === "墨"), "切回项目一：字模仍在");
  eq(api.getState().placements.length, 1, "切回项目一：落字仍在");
  eq(api.getState().drafts.length, 1, "切回项目一：草稿仍在");

  // 项目二的数据也完好
  env.selectProject(api.getRoot().projects[1].id);
  eq(api.getState().placements.length, 1, "项目二的落字未被项目一污染");
  ok(!api.getState().inventory.some((t) => t.char === "墨"), "项目二仍没有项目一的字模");
}

/* ------------------------------------------------------------------ */
/* 7. 刷新后全部保留                                                     */
/* ------------------------------------------------------------------ */

section("刷新持久化：项目、版面、字模、落字、草稿、设置");
{
  const storage = makeStorage();

  // 第一次会话：建 2 个项目，项目1 有 2 个版面，数据各不相同
  let env = boot(storage, { prompt: () => "项目二" });
  {
    const { api, el } = env;
    addType(api, el, { char: "竹", style: "手写体" });
    api.getState().selectedTypeId = api.getState().inventory.find((t) => t.char === "竹").id;
    api.placeType(0, 0);
    setSetting(el, "#workTitle", "刷新测试A");
    el("#workTitle").fire("input");
    setSetting(el, "#paperSize", "bookmark");
    api.saveDraft();

    env.dialog.promptImpl = () => "第二版面";
    api.newLayout();
    api.getState().selectedTypeId = api.getState().inventory[0].id;
    api.placeType(3, 3);
    api.saveDraft();

    env.dialog.promptImpl = () => "项目二";
    api.newProject();
    setSetting(el, "#workTitle", "项目二作品");
    el("#workTitle").fire("input");
  }

  // 第二次会话：复用同一 localStorage，等价于刷新
  env = boot(storage);
  {
    const { api } = env;
    eq(api.getRoot().projects.length, 2, "刷新后 2 个项目都在");
    eq(api.getRoot().projects[0].name, "项目1", "刷新后项目1 名称在");
    eq(api.getRoot().projects[1].name, "项目二", "刷新后项目二名称在");
    eq(api.getActiveProject().name, "项目二", "刷新后仍停留在刷新前的项目");

    const p1 = api.getRoot().projects[0];
    eq(p1.layouts.length, 2, "刷新后项目1 的 2 个版面都在");
    ok(p1.layouts.some((l) => l.name === "第二版面"), "刷新后版面名称在");

    // 切到项目1 / 版面1 核对
    env.selectProject(p1.id);
    env.selectLayout(p1.layouts[0].id);
    ok(api.getState().inventory.some((t) => t.char === "竹"), "刷新后自定义字模在");
    eq(api.getState().placements.length, 1, "刷新后版面1 落字在");
    eq(api.getState().drafts.length, 1, "刷新后版面1 草稿在");
    eq(api.getState().settings.workTitle, "刷新测试A", "刷新后作品名在");
    eq(api.getState().settings.paperSize, "bookmark", "刷新后纸张设置在");

    // 版面2
    env.selectLayout(p1.layouts[1].id);
    eq(api.getState().placements.length, 1, "刷新后版面2 落字在");
    eq(api.getState().drafts.length, 1, "刷新后版面2 草稿在");
    ok(!api.getState().inventory.some((t) => t.char === "竹"), "刷新后版面2 仍无版面1 的字模（隔离保持）");

    // 项目二
    env.selectProject(api.getRoot().projects[1].id);
    eq(api.getState().settings.workTitle, "项目二作品", "刷新后项目二设置在");

    // 存储结构版本
    eq(persistCount(storage).version, 2, "存储标记为 v2 结构");
  }

  // 第三次会话：刷新后再操作并再刷新，确认状态机持续可用
  env = boot(storage);
  {
    const { api } = env;
    const before = snapshot(api.getRoot());
    api.renderAll();
    const after = snapshot(api.getRoot());
    ok(JSON.stringify(before) === JSON.stringify(after), "重复刷新/渲染不会改动或丢失数据");
  }
}

/* ------------------------------------------------------------------ */
/* 8. 旧 v1 数据迁移                                                     */
/* ------------------------------------------------------------------ */

function legacyState(overrides = {}) {
  return {
    inventory: [
      { id: "t1", char: "山", style: "宋体旧字", size: 30, quantity: 4, wear: "微磨" },
      { id: "t2", char: "月", style: "宋体旧字", size: 30, quantity: 3, wear: "旧痕" }
    ],
    selectedTypeId: "t1",
    placements: [{ row: 0, col: 0, typeId: "t1" }],
    drafts: [
      {
        id: "d1",
        title: "旧草稿",
        settings: { paperSize: "bookmark", flowMode: "vertical", gridGap: 10, workTitle: "旧作" },
        placements: [{ row: 1, col: 1, typeId: "t2" }],
        savedAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    settings: { paperSize: "square", flowMode: "vertical", gridGap: 12, workTitle: "迁移作品" },
    ...overrides
  };
}

section("旧数据迁移：v1 单项目数据完整升级为 v2");
{
  const storage = makeStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify(legacyState()));
  const env = boot(storage);
  const { api } = env;

  eq(api.getRoot().version, 2, "迁移后版本为 v2");
  eq(api.getRoot().projects.length, 1, "旧数据迁移为 1 个项目");
  eq(api.getActiveProject().layouts.length, 1, "旧数据收进 1 个默认版面");
  eq(api.getActiveLayout().name, "默认版面", "迁移版面名为「默认版面」");

  eq(api.getState().inventory.length, 2, "旧字模库完整迁移");
  ok(api.getState().inventory.every((t) => t.id === "t1" || t.id === "t2"), "旧字模 id 保留（落字引用不断）");
  eq(api.getState().selectedTypeId, "t1", "旧选中字模迁移");
  eq(api.getState().placements.length, 1, "旧落字完整迁移");
  eq(api.getState().placements[0].typeId, "t1", "迁移后的落字仍指向原字模");

  eq(api.getState().settings.paperSize, "square", "旧纸张设置迁移");
  eq(api.getState().settings.flowMode, "vertical", "旧方向设置迁移");
  eq(api.getState().settings.gridGap, 12, "旧网格设置迁移");
  eq(api.getState().settings.workTitle, "迁移作品", "旧作品名迁移");

  eq(api.getState().drafts.length, 1, "旧草稿完整迁移");
  const draft = api.getState().drafts[0];
  eq(draft.title, "旧草稿", "草稿标题迁移");
  eq(draft.placements.length, 1, "草稿快照落字迁移");
  eq(draft.settings.workTitle, "旧作", "草稿快照设置迁移");

  // 迁移后立刻可正常使用：落字 + 再持久化 + 再刷新不回退
  api.placeType(0, 1);
  eq(api.getState().placements.length, 2, "迁移后可继续落字");
  const reStorage = persistCount(storage);
  ok(Array.isArray(reStorage.projects), "迁移后写回的是 v2 结构，不会再被识别成旧数据");

  const env2 = boot(storage);
  eq(env2.api.getRoot().projects.length, 1, "迁移数据刷新后仍正常");
  eq(env2.api.getState().placements.length, 2, "迁移后的新落字刷新后仍在");
}

section("旧数据迁移：边界与损坏数据不能导致迁移失败");
{
  // 8.1 空旧数据（字模删光、空草稿）也应安全迁移，不强行塞回示例字模
  {
    const storage = makeStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        inventory: [],
        selectedTypeId: "ghost",
        placements: [{ row: 0, col: 0, typeId: "ghost" }],
        drafts: [],
        settings: {}
      })
    );
    const env = boot(storage);
    eq(env.api.getRoot().projects.length, 1, "空字模的旧数据仍迁移出项目");
    eq(env.api.getState().inventory.length, 0, "空字模库原样保留（不强行补示例字模）");
    eq(env.api.getState().selectedTypeId, null, "悬空的选中字模被清空");
    eq(env.api.getState().placements.length, 0, "引用已删字模的落字在迁移时被清洗");
    eq(env.api.getState().settings.workTitle, "晚风小笺", "缺省设置回落默认值");
  }

  // 8.2 旧数据里含有畸形字模 / 非法落字 / 非法设置，迁移时被清洗而不是崩溃
  {
    const storage = makeStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        legacyState({
          inventory: [
            { id: "good", char: "好", style: "宋体", size: 999, quantity: -5, wear: "火星文" },
            { id: "bad" },
            null
          ],
          selectedTypeId: "ghost",
          placements: [
            { row: 0, col: 0, typeId: "good" },
            { row: -1, col: 2, typeId: "good" },
            { row: 1, col: 1, typeId: "missing" },
            null
          ],
          settings: { paperSize: "huge", flowMode: "diagonal", gridGap: 500, workTitle: 42 }
        })
      )
    );
    const env = boot(storage);
    const state = env.api.getState();
    eq(state.inventory.length, 1, "畸形字模条目被清洗，仅保留合法字模");
    eq(state.inventory[0].id, "good", "合法字模保留");
    eq(state.inventory[0].size, 72, "越界字号被夹到上限");
    eq(state.inventory[0].quantity, 1, "非法数量被夹到下限");
    eq(state.inventory[0].wear, "新", "非法磨损度回落默认");
    eq(state.selectedTypeId, "good", "失效的选中字模重指到现存字模");
    eq(state.placements.length, 1, "非法/悬空落字被清洗");
    eq(state.settings.paperSize, "postcard", "非法纸张回落默认");
    eq(state.settings.gridGap, 18, "越界网格间距被夹到上限");
  }

  // 8.3 损坏 JSON 不抛错，安全回落初始状态
  {
    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, "{损坏的 JSON");
    let env;
    let threw = false;
    try {
      env = boot(storage);
    } catch (err) {
      threw = true;
    }
    ok(!threw, "损坏 JSON 不会导致脚本报错");
    eq(env.api.getRoot().projects.length, 1, "损坏 JSON 回落为 1 个默认项目");
    eq(env.api.getState().inventory.length, 6, "损坏 JSON 后字模库可用");
  }

  // 8.4 没有任何存储：首次访问
  {
    const env = boot(makeStorage());
    eq(env.api.getRoot().projects.length, 1, "无存储时创建默认项目");
  }
}

/* ------------------------------------------------------------------ */
/* 9. 移除项目不影响其他项目；草稿载入/删除跟随版面                        */
/* ------------------------------------------------------------------ */

section("移除与草稿：删除范围准确，不波及其他项目/版面");
{
  const env = boot(makeStorage(), { prompt: () => "将被删除的项目" });
  const { api, dialog } = env;

  // 项目一放数据
  addType(api, env.el, { char: "留", style: "宋体" });
  api.getState().selectedTypeId = api.getState().inventory.find((t) => t.char === "留").id;
  api.placeType(0, 0);
  api.saveDraft();
  const keepId = api.getActiveProject().id;

  // 项目二放数据后删除
  api.newProject();
  addType(api, env.el, { char: "删", style: "楷体" });
  api.placeType(1, 1);
  api.saveDraft();
  eq(api.getRoot().projects.length, 2, "删除前有 2 个项目");

  dialog.confirmImpl = () => true;
  api.removeProject();
  eq(api.getRoot().projects.length, 1, "项目二被删除");
  eq(api.getActiveProject().id, keepId, "自动切回项目一");
  ok(api.getState().inventory.some((t) => t.char === "留"), "项目一的字模未被波及");
  eq(api.getState().placements.length, 1, "项目一的落字未被波及");
  eq(api.getState().drafts.length, 1, "项目一的草稿未被波及");

  // 草稿删除/载入只作用当前版面
  const draftId = api.getState().drafts[0].id;
  // 先把版面清空再载入草稿
  api.getState().placements = [];
  env.el("#draftList").fire("click", {
    target: { closest: (sel) => (sel === "[data-load-draft]" ? { dataset: { loadDraft: draftId } } : null) }
  });
  eq(api.getState().placements.length, 1, "草稿可正常载回落字");
}

/* ------------------------------------------------------------------ */
/* 10. 备份导出                                                          */
/* ------------------------------------------------------------------ */

section("备份导出：全量项目数据打包为 JSON 文件");
{
  const env = boot(makeStorage(), { prompt: () => "项目二" });
  const { api, el } = env;

  // 造数据：2 个项目，项目1 有 2 个版面，含字模/落字/草稿/非默认设置
  addType(api, el, { char: "竹", style: "手写体" });
  api.getState().selectedTypeId = api.getState().inventory.find((t) => t.char === "竹").id;
  api.placeType(0, 0);
  setSetting(el, "#workTitle", "导出版标题");
  el("#workTitle").fire("input");
  setSetting(el, "#paperSize", "bookmark");
  api.saveDraft();
  env.dialog.promptImpl = () => "第二版面";
  api.newLayout();
  api.placeType(2, 2);
  env.dialog.promptImpl = () => "项目二";
  api.newProject();

  const backup = api.buildBackup();
  eq(backup.kind, "movable-type-workshop-backup", "备份带类型标记 kind");
  eq(backup.version, 2, "备份带结构版本号");
  ok(typeof backup.exportedAt === "string" && !Number.isNaN(Date.parse(backup.exportedAt)), "备份带导出时间");
  eq(backup.root.projects.length, 2, "备份包含全部 2 个项目");
  eq(backup.root.projects[0].layouts.length, 2, "备份包含项目1 的 2 个版面");
  const exportedLayout = backup.root.projects[0].layouts[0];
  ok(exportedLayout.inventory.some((t) => t.char === "竹"), "备份包含自定义字模");
  eq(exportedLayout.placements.length, 1, "备份包含落字");
  eq(exportedLayout.drafts.length, 1, "备份包含草稿");
  eq(exportedLayout.settings.workTitle, "导出版标题", "备份包含作品名设置");
  eq(exportedLayout.settings.paperSize, "bookmark", "备份包含纸张设置");
  eq(backup.root.activeProjectId, api.getRoot().projects[1].id, "备份记录当前活动项目");

  // 备份必须是深拷贝，不能与活数据共享任何数组/对象引用
  ok(backup.root !== api.getRoot(), "备份 root 是独立对象");
  ok(backup.root.projects !== api.getRoot().projects, "备份的项目数组不共享引用");
  const liveLayout = api.getRoot().projects[0].layouts[0];
  const backupLayout = backup.root.projects[0].layouts[0];
  ok(backupLayout.inventory !== liveLayout.inventory, "备份的字模库数组不共享引用");
  ok(backupLayout.placements !== liveLayout.placements, "备份的落字数组不共享引用");
  ok(backupLayout.drafts !== liveLayout.drafts, "备份的草稿数组不共享引用");
  ok(backupLayout.settings !== liveLayout.settings, "备份的设置对象不共享引用");

  // 备份是深拷贝：之后继续操作不会污染已生成的备份
  const backupJson = JSON.stringify(backup);
  api.getRoot().projects[0].layouts[0].placements.push({ row: 9, col: 9, typeId: "x" });
  const backup2 = api.buildBackup();
  ok(!backupJson.includes('"row":9'), "先前生成的备份保持当时快照（不含之后新增的落字）");
  ok(JSON.stringify(backup2.root.projects[0].layouts[0].placements).includes('"row":9'), "重新导出反映最新数据");

  // exportBackup 真正触发文件下载，文件名含 .json
  el("#exportBackupBtn").click();
  eq(env.downloads.length, 1, "点击导出产生一次下载");
  ok(/\.json$/i.test(env.downloads[0].download), "下载文件名以 .json 结尾");
  ok(/备份/.test(env.downloads[0].download), "下载文件名包含「备份」");
  eq(env.downloads[0].href, "blob:stub", "下载指向生成的 Blob URL");

  // 点击「导入备份」会先清空文件输入，使同一文件可被重复选择
  el("#backupFileInput").value = "C:\\fakepath\\old.json";
  el("#importBackupBtn").click();
  eq(el("#backupFileInput").value, "", "打开选择框前清空旧的文件选择（支持重复导入同一文件）");
}

/* ------------------------------------------------------------------ */
/* 11. 备份导入（恢复）—— 异步 UI 流程                                    */
/* ------------------------------------------------------------------ */

async function runImportTests() {
  section("备份导入：确认后覆盖，取消不动数据，刷新一致");
  {
    // 源环境：构造一份含 2 个项目的备份文本
    const sourceEnv = boot(makeStorage(), { prompt: () => "项目二" });
    {
      const { api, el } = sourceEnv;
      addType(api, el, { char: "墨", style: "金文体" });
      api.getState().selectedTypeId = api.getState().inventory.find((t) => t.char === "墨").id;
      api.placeType(4, 4);
      setSetting(el, "#workTitle", "恢复后的标题");
      el("#workTitle").fire("input");
      api.saveDraft();
      sourceEnv.dialog.promptImpl = () => "项目二";
      api.newProject();
    }
    const backupText = JSON.stringify(sourceEnv.api.buildBackup());

    // 目标环境：默认 1 个项目，先做一些「将被覆盖」的数据
    const storage = makeStorage();
    let env = boot(storage, { confirm: () => false });
    {
      const { api, el } = env;
      addType(api, el, { char: "旧", style: "旧风格" });
      api.placeType(1, 1);
      const before = snapshot(api.getRoot());

      // 11.1 确认框点取消：数据原封不动，不弹成功提示
      await env.chooseBackupFile({ name: "backup.json", __text: backupText });
      eq(env.dialog.confirmCalls, 1, "导入前弹出确认框");
      ok(/覆盖/.test(env.dialog.lastConfirmMessage || ""), "确认文案明确提示会覆盖当前数据");
      ok(/2 个项目/.test(env.dialog.lastConfirmMessage || ""), "确认文案列出备份中的项目数");
      eq(env.dialog.alerts.length, 0, "取消后不弹结果提示");
      eq(JSON.stringify(snapshot(api.getRoot())), JSON.stringify(before), "取消导入：当前数据完全不变");
      const persisted = persistCount(storage);
      eq(persisted.projects.length, 1, "取消导入：存储未被改写");
      ok(persisted.projects[0].layouts[0].inventory.some((t) => t.char === "旧"), "取消导入：旧字模仍在");

      // 11.2 确认导入：全量覆盖
      env.dialog.confirmImpl = () => true;
      await env.chooseBackupFile({ name: "backup.json", __text: backupText });
      // 导入即持久化：在用户做任何后续切换之前，存储就必须已是备份内容
      const immediatePersist = persistCount(storage);
      eq(immediatePersist.projects.length, 2, "导入完成瞬间结果已写入本地存储（无需额外操作）");
      const root = api.getRoot();
      eq(root.projects.length, 2, "确认导入：项目被覆盖为备份的 2 个");
      eq(api.getActiveProject().name, "项目二", "确认导入：停留在备份记录的活动项目");
      env.selectProject(root.projects[0].id);
      ok(api.getState().inventory.some((t) => t.char === "墨"), "确认导入：备份字模已恢复");
      ok(!api.getState().inventory.some((t) => t.char === "旧"), "确认导入：原有旧字模被覆盖清除");
      eq(api.getState().placements.length, 1, "确认导入：落字恢复");
      eq(api.getState().drafts.length, 1, "确认导入：草稿恢复");
      eq(api.getState().settings.workTitle, "恢复后的标题", "确认导入：设置恢复");
      ok(/导入成功/.test(env.dialog.alerts.join("")), "导入成功有明确提示");

      // 导入即持久化（不依赖再次操作）
      const afterPersist = persistCount(storage);
      eq(afterPersist.projects.length, 2, "导入结果已写入本地存储");
    }

    // 11.3 刷新后与导入结果完全一致
    env = boot(storage);
    {
      const { api } = env;
      eq(api.getRoot().projects.length, 2, "刷新后 2 个项目仍在");
      const p1 = api.getRoot().projects[0];
      env.selectProject(p1.id);
      ok(api.getState().inventory.some((t) => t.char === "墨"), "刷新后恢复的字模在");
      eq(api.getState().placements.length, 1, "刷新后恢复的落字在");
      eq(api.getState().drafts.length, 1, "刷新后恢复的草稿在");
      eq(api.getState().settings.workTitle, "恢复后的标题", "刷新后恢复的设置在");

      // 11.4 导入后原有项目/版面操作继续可用
      env.dialog.promptImpl = () => "恢复后新版面";
      api.newLayout();
      eq(api.getActiveProject().layouts.length, 2, "导入后仍可新建版面");
      api.getState().selectedTypeId = api.getState().inventory[0].id;
      api.placeType(0, 0);
      eq(api.getState().placements.length, 1, "导入后的新版面可正常落字");
      api.saveDraft();
      eq(api.getState().drafts.length, 1, "导入后的新版面可正常存草稿");

      env.dialog.confirmImpl = () => false;
      const projectsBeforeRemove = api.getRoot().projects.length;
      env.selectProject(api.getRoot().projects[1].id);
      api.removeProject();
      eq(api.getRoot().projects.length, projectsBeforeRemove, "导入后的项目移除仍受确认框保护");
      env.selectProject(p1.id);
      env.dialog.promptImpl = () => "恢复后改名";
      api.renameProject();
      eq(api.getActiveProject().name, "恢复后改名", "导入后可重命名项目");
    }
  }

  section("备份导入：损坏/错误文件给出明确提示且不动数据");
  {
    const badCases = [
      { label: "不是 JSON 文本", file: { __text: "我不是JSON{" }, expect: /合法的 JSON/ },
      { label: "JSON 但类型不符", file: { __text: JSON.stringify({ kind: "some-other-backup", root: {} }) }, expect: /不是活字排版工坊的备份/ },
      { label: "空对象", file: { __text: JSON.stringify({}) }, expect: /没有任何项目/ },
      { label: "projects 不是数组", file: { __text: JSON.stringify({ projects: "x" }) }, expect: /没有任何项目/ },
      { label: "项目里没有版面", file: { __text: JSON.stringify({ projects: [{ id: "p", name: "P", layouts: [] }] }) }, expect: /没有任何版面/ },
      { label: "版面缺字模库", file: { __text: JSON.stringify({ projects: [{ id: "p", name: "P", layouts: [{ id: "l", name: "L", placements: [], drafts: [], settings: {} }] }] }) }, expect: /字模库/ },
      { label: "版面缺落字", file: { __text: JSON.stringify({ projects: [{ id: "p", name: "P", layouts: [{ id: "l", name: "L", inventory: [], drafts: [], settings: {} }] }] }) }, expect: /落字/ },
      { label: "版面缺草稿", file: { __text: JSON.stringify({ projects: [{ id: "p", name: "P", layouts: [{ id: "l", name: "L", inventory: [], placements: [], settings: {} }] }] }) }, expect: /草稿/ },
      { label: "版面缺设置", file: { __text: JSON.stringify({ projects: [{ id: "p", name: "P", layouts: [{ id: "l", name: "L", inventory: [], placements: [], drafts: [] }] }] }) }, expect: /设置/ },
      {
        label: "项目 id 重复",
        file: {
          __text: JSON.stringify({
            kind: "movable-type-workshop-backup",
            root: {
              projects: [
                { id: "dupP", name: "甲项目", activeLayoutId: "l1", layouts: [{ id: "l1", name: "版面1", inventory: [], placements: [], drafts: [], settings: {} }] },
                { id: "dupP", name: "乙项目", activeLayoutId: "l2", layouts: [{ id: "l2", name: "版面2", inventory: [], placements: [], drafts: [], settings: {} }] }
              ]
            }
          })
        },
        expect: /重复的项目 id「dupP」.*甲项目.*乙项目/
      },
      {
        label: "版面 id 重复（同一项目内）",
        file: {
          __text: JSON.stringify({
            kind: "movable-type-workshop-backup",
            root: {
              projects: [
                {
                  id: "p1",
                  name: "诗集",
                  activeLayoutId: "dupL",
                  layouts: [
                    { id: "dupL", name: "春卷", inventory: [], placements: [], drafts: [], settings: {} },
                    { id: "dupL", name: "秋卷", inventory: [], placements: [], drafts: [], settings: {} }
                  ]
                }
              ]
            }
          })
        },
        expect: /重复的版面 id「dupL」.*春卷.*秋卷/
      }
    ];

    for (const bad of badCases) {
      const env = boot(makeStorage(), { confirm: () => true });
      addType(env.api, env.el, { char: "原有字", style: "原有风格" });
      env.api.placeType(0, 0);
      const before = snapshot(env.api.getRoot());

      await env.chooseBackupFile({ name: "bad.json", ...bad.file });
      const joinedAlerts = env.dialog.alerts.join("");
      ok(/导入失败/.test(joinedAlerts), `[${bad.label}] 有「导入失败」提示`);
      ok(bad.expect.test(joinedAlerts), `[${bad.label}] 提示原因符合预期（${bad.expect}）`);
      ok(/未被改动/.test(joinedAlerts), `[${bad.label}] 提示当前数据未被改动`);
      eq(env.dialog.confirmCalls, 0, `[${bad.label}] 文件不合法时不弹覆盖确认框`);
      eq(JSON.stringify(snapshot(env.api.getRoot())), JSON.stringify(before), `[${bad.label}] 当前数据保持不变`);
      eq(persistCount(env.storage).projects[0].layouts[0].inventory.length, before.projects[0].layouts[0].inventory.length, `[${bad.label}] 存储未被改写`);
    }

    // 跨项目版面 id 相同是合法的（版面 id 只要求项目内唯一），必须正常恢复
    {
      const crossProjectText = JSON.stringify({
        kind: "movable-type-workshop-backup",
        root: {
          projects: [
            {
              id: "pa",
              name: "项目甲",
              activeLayoutId: "sharedL",
              layouts: [
                { id: "sharedL", name: "同号版面", inventory: [], placements: [], drafts: [], settings: { workTitle: "甲的同号" } }
              ]
            },
            {
              id: "pb",
              name: "项目乙",
              activeLayoutId: "sharedL",
              layouts: [
                { id: "sharedL", name: "同号版面", inventory: [], placements: [], drafts: [], settings: { workTitle: "乙的同号" } }
              ]
            }
          ],
          activeProjectId: "pa"
        }
      });
      const storage = makeStorage();
      const env = boot(storage, { confirm: () => true });
      await env.chooseBackupFile({ name: "ok.json", __text: crossProjectText });
      eq(env.api.getRoot().projects.length, 2, "跨项目版面同 id：导入成功，2 个项目都在");
      // 两个项目都能被独立切换命中（这正是项目 id 去重要保护的可达性）
      env.selectProject("pa");
      eq(env.api.getActiveProject().name, "项目甲", "跨项目同版面 id：可切到项目甲");
      eq(env.api.getState().settings.workTitle, "甲的同号", "项目甲命中自己的版面");
      env.selectProject("pb");
      eq(env.api.getActiveProject().name, "项目乙", "跨项目同版面 id：可切到项目乙");
      eq(env.api.getState().settings.workTitle, "乙的同号", "项目乙命中自己的版面（不被甲遮蔽）");
    }

    // 同步入口的返回结构同样明确
    {
      const env = boot(makeStorage());
      const r1 = env.api.importBackupText("{bad");
      ok(r1.error && !r1.root, "importBackupText 对坏 JSON 返回 error 而非抛异常");
      const r2 = env.api.importBackupText(JSON.stringify({ projects: [] }));
      ok(/没有任何项目/.test(r2.error || ""), "空项目数组被判为损坏");
      const dupProject = JSON.stringify({
        projects: [
          { id: "d", name: "甲", layouts: [{ id: "l", name: "L", inventory: [], placements: [], drafts: [], settings: {} }] },
          { id: "d", name: "乙", layouts: [{ id: "l2", name: "L2", inventory: [], placements: [], drafts: [], settings: {} }] }
        ]
      });
      const r3 = env.api.importBackupText(dupProject);
      ok(/重复的项目 id/.test(r3.error || ""), "同步入口也拒绝重复项目 id 并说明原因");
      ok(!r3.root, "重复项目 id 时不返回可用 root");
    }

    // 文件读取失败（如权限问题）
    {
      const env = boot(makeStorage(), { confirm: () => true });
      const before = snapshot(env.api.getRoot());
      await env.chooseBackupFile({ name: "x.json", __text: "", __readError: true });
      ok(/无法读取/.test(env.dialog.alerts.join("")), "文件读取失败有明确提示");
      eq(env.dialog.confirmCalls, 0, "读取失败不弹覆盖确认框");
      eq(JSON.stringify(snapshot(env.api.getRoot())), JSON.stringify(before), "读取失败不动数据");
    }

    // 空选择（未选文件直接触发 change）安全返回
    {
      const env = boot(makeStorage());
      let threw = false;
      try {
        await env.chooseBackupFile(null);
      } catch {
        threw = true;
      }
      ok(!threw, "未选择文件时不报错");
    }
  }
}

/* ------------------------------------------------------------------ */
/* 汇总（等待异步导入测试完成后再输出）                                    */
/* ------------------------------------------------------------------ */

function finish() {
  console.log(`\n========================================`);
  if (failed === 0) {
    console.log(`回归测试全部通过：${passed} 项断言`);
    process.exit(0);
  } else {
    console.log(`${failed} 项失败，${passed} 项通过：`);
    for (const message of failures) console.log(`  - ${message}`);
    process.exit(1);
  }
}

runImportTests().then(finish).catch((error) => {
  console.error("\n测试运行器异常：", error);
  process.exit(1);
});
