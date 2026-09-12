#!/usr/bin/env node
/**
 * 安装 Git 提交前检查钩子：.git/hooks/pre-commit -> scripts/pre-commit
 *
 * - 在 git 仓库内执行 `npm install` 时会经 package.json 的 prepare 自动运行；
 * - 也可随时手动执行 `npm run install-hooks`；
 * - 不在 git 仓库内时安静跳过（返回 0），不影响安装与 CI。
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SOURCE = path.join(ROOT, "scripts", "pre-commit");

function gitCommonDir() {
  try {
    const out = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return path.resolve(ROOT, out);
  } catch {
    return null;
  }
}

const gitDir = gitCommonDir();
if (!gitDir) {
  console.log("install-hooks: 当前不是 git 仓库，跳过提交前检查安装。");
  process.exit(0);
}

const hooksDir = path.join(gitDir, "hooks");
fs.mkdirSync(hooksDir, { recursive: true });

const target = path.join(hooksDir, "pre-commit");
const content = fs.readFileSync(SOURCE);
const existing = fs.existsSync(target) ? fs.readFileSync(target) : null;

if (existing && existing.equals(content)) {
  console.log("install-hooks: pre-commit 钩子已是最新，无需更新。");
} else {
  fs.writeFileSync(target, content, { mode: 0o755 });
  // writeFileSync 的 mode 在文件已存在时不会改权限，显式 chmod 兜底
  fs.chmodSync(target, 0o755);
  console.log(`install-hooks: 已安装提交前检查 -> ${path.relative(ROOT, target)}`);
}
