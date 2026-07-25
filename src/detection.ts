import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { DetectionSignal, ProjectDetection } from "./types.js";

interface Rule {
  technology: string;
  query: string;
  requiredTerms: string[];
  files?: string[];
  dependencies?: string[];
  content?: Array<{ file: string; pattern: RegExp }>;
}

const RULES: Rule[] = [
  {
    technology: "Next.js",
    query: "nextjs react",
    requiredTerms: ["next", "nextjs"],
    dependencies: ["next"],
  },
  {
    technology: "React",
    query: "react frontend",
    requiredTerms: ["react"],
    dependencies: ["react", "react-dom"],
  },
  {
    technology: "Vue",
    query: "vue frontend",
    requiredTerms: ["vue"],
    dependencies: ["vue", "nuxt"],
  },
  {
    technology: "Svelte",
    query: "svelte frontend",
    requiredTerms: ["svelte", "sveltekit"],
    dependencies: ["svelte", "@sveltejs/kit"],
  },
  {
    technology: "Tailwind CSS",
    query: "tailwind css",
    requiredTerms: ["tailwind"],
    files: ["tailwind.config.js", "tailwind.config.ts", "tailwind.config.mjs"],
    dependencies: ["tailwindcss"],
  },
  {
    technology: "TypeScript",
    query: "typescript",
    requiredTerms: ["typescript"],
    files: ["tsconfig.json"],
    dependencies: ["typescript"],
  },
  {
    technology: "Playwright",
    query: "playwright testing",
    requiredTerms: ["playwright"],
    files: ["playwright.config.ts", "playwright.config.js"],
    dependencies: ["@playwright/test", "playwright"],
  },
  {
    technology: "Prisma",
    query: "prisma database",
    requiredTerms: ["prisma"],
    files: ["prisma/schema.prisma"],
    dependencies: ["prisma", "@prisma/client"],
  },
  {
    technology: "Supabase",
    query: "supabase database",
    requiredTerms: ["supabase"],
    files: ["supabase/config.toml"],
    dependencies: ["@supabase/supabase-js"],
  },
  {
    technology: "Django",
    query: "django python",
    requiredTerms: ["django"],
    content: [
      { file: "requirements.txt", pattern: /(?:^|\n)django(?:[=<>~!]|$)/i },
      { file: "pyproject.toml", pattern: /\bdjango\b/i },
    ],
  },
  {
    technology: "FastAPI",
    query: "fastapi python",
    requiredTerms: ["fastapi"],
    content: [
      { file: "requirements.txt", pattern: /(?:^|\n)fastapi(?:[=<>~!]|$)/i },
      { file: "pyproject.toml", pattern: /\bfastapi\b/i },
    ],
  },
  {
    technology: "Rust",
    query: "rust",
    requiredTerms: ["rust"],
    files: ["Cargo.toml"],
  },
  {
    technology: "Go",
    query: "golang",
    requiredTerms: ["go", "golang"],
    files: ["go.mod"],
  },
  {
    technology: "Spring Boot",
    query: "spring boot java",
    requiredTerms: ["spring"],
    content: [
      { file: "pom.xml", pattern: /spring-boot/i },
      { file: "build.gradle", pattern: /spring-boot/i },
      { file: "build.gradle.kts", pattern: /spring-boot/i },
    ],
  },
];

const ROOT_MARKERS = new Set([
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
]);

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
]);

function safeRead(path: string, maxBytes = 1_000_000): string {
  try {
    const content = readFileSync(path, "utf8");
    return content.length <= maxBytes ? content : "";
  } catch {
    return "";
  }
}

function packageDependencies(root: string): Set<string> {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) return new Set();
  try {
    const parsed = JSON.parse(safeRead(packagePath)) as Record<string, unknown>;
    const names = new Set<string>();
    for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
      const deps = parsed[section];
      if (deps && typeof deps === "object") {
        Object.keys(deps).forEach((name) => names.add(name));
      }
    }
    return names;
  } catch {
    return new Set();
  }
}

function matchRule(
  root: string,
  dependencies: Set<string>,
  rule: Rule,
): DetectionSignal | null {
  const evidence: string[] = [];
  for (const file of rule.files ?? []) {
    if (existsSync(join(root, file))) evidence.push(file);
  }
  for (const dependency of rule.dependencies ?? []) {
    if (dependencies.has(dependency)) evidence.push(`package:${dependency}`);
  }
  for (const check of rule.content ?? []) {
    const value = safeRead(join(root, check.file));
    if (value && check.pattern.test(value)) evidence.push(`${check.file}:content`);
  }
  if (evidence.length === 0) return null;

  const evidenceKinds = new Set(evidence.map((item) => item.split(":")[0]));
  return {
    technology: rule.technology,
    confidence: Math.min(
      1,
      0.65 + (evidence.length - 1) * 0.15 + (evidenceKinds.size - 1) * 0.1,
    ),
    evidence,
    query: rule.query,
    requiredTerms: rule.requiredTerms,
  };
}

function projectRoots(root: string, maxDepth = 3, maxDirectories = 500): string[] {
  const roots = new Set([root]);
  let visited = 0;

  function walk(directory: string, depth: number): void {
    if (depth > maxDepth || visited >= maxDirectories) return;
    visited += 1;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.isFile() && ROOT_MARKERS.has(entry.name))) {
      roots.add(directory);
    }
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        !IGNORED_DIRECTORIES.has(entry.name) &&
        !entry.name.startsWith(".")
      ) {
        walk(join(directory, entry.name), depth + 1);
      }
    }
  }

  walk(root, 0);
  return [...roots].sort();
}

export function detectProject(root: string): ProjectDetection {
  const merged = new Map<string, DetectionSignal>();
  for (const detectedRoot of projectRoots(root)) {
    const dependencies = packageDependencies(detectedRoot);
    for (const rule of RULES) {
      const signal = matchRule(detectedRoot, dependencies, rule);
      if (!signal) continue;
      const prefix = relative(root, detectedRoot);
      const evidence = signal.evidence.map((item) =>
        prefix ? `${prefix}/${item}` : item,
      );
      const existing = merged.get(signal.technology);
      merged.set(signal.technology, {
        ...signal,
        confidence: Math.max(signal.confidence, existing?.confidence ?? 0),
        evidence: [...new Set([...(existing?.evidence ?? []), ...evidence])],
      });
    }
  }
  const signals = [...merged.values()].sort(
    (a, b) => b.confidence - a.confidence || a.technology.localeCompare(b.technology),
  );

  if (signals.length === 0) {
    signals.push({
      technology: "General software project",
      confidence: 0.5,
      evidence: [basename(root)],
      query: "software development",
      requiredTerms: ["development"],
    });
  }

  const fingerprint = createHash("sha256")
    .update(JSON.stringify(signals))
    .digest("hex");

  return { root, fingerprint, signals };
}
