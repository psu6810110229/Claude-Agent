import fs from "node:fs";
import path from "node:path";
import { MEMORY_DIR } from "../config.js";
import type {
  MemoryTarget,
  MemoryWriteMode,
} from "../schemas/memory.js";

/** Thrown when a memory file operation is unsafe or fails. */
export class MemoryStoreError extends Error {}

/**
 * Fixed target -> filename whitelist. This is the ONLY mapping from an API
 * target to a file. There is no way to pass an arbitrary path.
 */
const TARGET_FILES: Record<MemoryTarget, string> = {
  preferences: "preferences.md",
  routines: "routines.md",
  projects: "projects.md",
  decisions: "decisions.md",
};

/** Seed/template header written when a target file does not yet exist. */
const TEMPLATES: Record<MemoryTarget, string> = {
  preferences: "# Preferences\n\n",
  routines: "# Routines\n\n",
  projects: "# Projects\n\n",
  decisions: "# Decisions\n\n",
};

/** Relative POSIX path stored in memory_index for human readability. */
export function memoryRelPath(target: MemoryTarget): string {
  return `memory/${TARGET_FILES[target]}`;
}

/**
 * Resolve a target to an absolute path and assert it stays inside MEMORY_DIR.
 * Defence-in-depth: the whitelist already prevents traversal, but we verify the
 * resolved path is contained before any read/write.
 */
function resolveTargetPath(target: MemoryTarget): string {
  const fileName = TARGET_FILES[target];
  if (!fileName) throw new MemoryStoreError(`Unknown memory target: ${target}`);
  const abs = path.resolve(MEMORY_DIR, fileName);
  const root = path.resolve(MEMORY_DIR);
  if (abs !== path.join(root, fileName) || path.dirname(abs) !== root) {
    throw new MemoryStoreError("Resolved memory path escapes the memory root");
  }
  return abs;
}

/** Ensure MEMORY_DIR exists and every target file has at least a template. */
export function ensureMemoryFiles(): void {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  for (const target of Object.keys(TARGET_FILES) as MemoryTarget[]) {
    const abs = resolveTargetPath(target);
    if (!fs.existsSync(abs)) {
      fs.writeFileSync(abs, TEMPLATES[target], "utf8");
    }
  }
}

/** Read one whitelisted memory file. Missing file -> exists:false, empty body. */
export function readMemory(target: MemoryTarget): {
  exists: boolean;
  content: string;
} {
  const abs = resolveTargetPath(target);
  if (!fs.existsSync(abs)) return { exists: false, content: "" };
  return { exists: true, content: fs.readFileSync(abs, "utf8") };
}

/**
 * Apply an approved write. `replace` overwrites the file; `append` adds the
 * content to the end (with a separating newline if the file is non-empty).
 * Returns the relative path for logging/indexing.
 */
export function writeMemory(
  target: MemoryTarget,
  mode: MemoryWriteMode,
  content: string,
): string {
  const abs = resolveTargetPath(target);
  fs.mkdirSync(MEMORY_DIR, { recursive: true });

  if (mode === "replace") {
    fs.writeFileSync(abs, content, "utf8");
  } else {
    const existing = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
    const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    fs.appendFileSync(abs, `${sep}${content}`, "utf8");
  }
  return memoryRelPath(target);
}
