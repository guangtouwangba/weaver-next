// Install the repo's Claude Code skills into a developer's skills directory so
// anyone who clones the repo can use them (e.g. /weaver-open).
//
//   node scripts/install-claude-skills.mjs            # install into <repo>/.claude/skills (this project)
//   node scripts/install-claude-skills.mjs --global   # install into ~/.claude/skills (all projects)
//
// Source of truth lives in tools/claude-skills/*. Re-run after pulling updates.
// Then run /reload-skills in Claude Code (or restart it) to pick them up.
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const sourceDir = join(repoRoot, "tools", "claude-skills");
const isGlobal = process.argv.includes("--global");
const targetDir = isGlobal ? join(homedir(), ".claude", "skills") : join(repoRoot, ".claude", "skills");

if (!existsSync(sourceDir)) {
  console.error(`No Claude skills source found at ${sourceDir}`);
  process.exit(1);
}

const skills = readdirSync(sourceDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(sourceDir, entry.name, "SKILL.md")));

if (!skills.length) {
  console.error(`No skills (folders with a SKILL.md) found under ${sourceDir}`);
  process.exit(1);
}

mkdirSync(targetDir, { recursive: true });
for (const skill of skills) {
  cpSync(join(sourceDir, skill.name), join(targetDir, skill.name), { recursive: true });
  console.log(`installed  ${skill.name}  ->  ${join(isGlobal ? "~/.claude/skills" : ".claude/skills", skill.name)}`);
}

console.log(`\nInstalled ${skills.length} skill(s) into ${isGlobal ? "~/.claude/skills" : ".claude/skills"}.`);
console.log("Run /reload-skills in Claude Code (or restart it), then try /weaver-open.");
