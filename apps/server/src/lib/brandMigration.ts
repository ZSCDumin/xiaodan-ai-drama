import { lstat, readFile, readdir, writeAtomic } from "@toonflow/file";
import { join } from "node:path";

// ACT: 仅迁移随软件分发的技能文案，保留技能逻辑、用户修改、作者归属与源链接。
export default async function migrateSkillBrand(targetDirectory: string, sourceDirectory: string) {
  const marker = join(targetDirectory, "xiaodanBrandInitialized");
  if (await readFile(marker, "utf8").then(() => true).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return false;
    throw error;
  })) return;

  async function rewrite(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await rewrite(path);
      else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "sourceMap.md") {
        const content = await readFile(path, "utf8");
        const branded = content.split("\n").map(line => /^\s*(author|github):|Copyright/i.test(line) ? line
          : line.replace(/(?<![A-Za-z0-9_./-])Toonflow(?![A-Za-z0-9_-])/g, "小丹AI漫剧")).join("\n");
        if (branded !== content) await writeAtomic(path, branded);
      }
    }
  }

  const builtins = await readdir(sourceDirectory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  if (!builtins.length) return;
  for (const entry of builtins) {
    if (!entry.isDirectory()) continue;
    const directory = join(targetDirectory, entry.name);
    const target = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (target?.isDirectory()) await rewrite(directory);
  }
  await writeAtomic(marker, "1");
}
