import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export type MaterializedRepository = {
  rootPath: string;
  repoUrl: string;
  repoSlug: string;
  repoName: string;
  branch: string;
  commit: string | null;
  source: "local" | "git";
};

const sourceDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(sourceDir, "../../../..");

export const defaultRepoCachePath = () => process.env.REPO_BOOKS_REPO_CACHE ?? resolve(repoRoot, ".local/repos");

export function materializeRepository(repoUrl: string, branch: string): MaterializedRepository {
  const raw = repoUrl.trim();
  if (!raw) throw new Error("REPO_URL_REQUIRED");

  const localPath = resolve(raw);
  if (existsSync(localPath) && statSync(localPath).isDirectory()) {
    const repoSlug = localPath.split(/[\\/]/).filter(Boolean).slice(-2).join("/") || "local/repository";
    return {
      rootPath: localPath,
      repoUrl: raw,
      repoSlug,
      repoName: repoSlug.split("/").pop() ?? "repository",
      branch: gitOutput(["-C", localPath, "branch", "--show-current"]) || branch,
      commit: gitOutput(["-C", localPath, "rev-parse", "--short", "HEAD"]) || null,
      source: "local"
    };
  }

  const gitUrl = normalizeGitUrl(raw);
  const repoSlug = repositorySlugFromUrl(gitUrl);
  const cacheRoot = defaultRepoCachePath();
  mkdirSync(cacheRoot, { recursive: true });
  const cacheKey = createHash("sha1").update(`${gitUrl}#${branch}`).digest("hex").slice(0, 10);
  const checkoutPath = resolve(cacheRoot, `${slugify(repoSlug)}-${cacheKey}`);
  rmSync(checkoutPath, { recursive: true, force: true });

  try {
    execFileSync("git", ["clone", "--depth", "1", "--branch", branch, gitUrl, checkoutPath], { stdio: "ignore" });
  } catch (error) {
    rmSync(checkoutPath, { recursive: true, force: true });
    execFileSync("git", ["clone", "--depth", "1", gitUrl, checkoutPath], { stdio: "ignore" });
  }

  return {
    rootPath: checkoutPath,
    repoUrl: gitUrl,
    repoSlug,
    repoName: repoSlug.split("/").pop() ?? "repository",
    branch: gitOutput(["-C", checkoutPath, "branch", "--show-current"]) || branch,
    commit: gitOutput(["-C", checkoutPath, "rev-parse", "--short", "HEAD"]) || null,
    source: "git"
  };
}

export function repositorySlugFromUrl(value: string) {
  const trimmed = value.trim().replace(/\/$/, "").replace(/\.git$/, "");
  const githubMatch = trimmed.match(/github\.com[:/](.+?\/.+?)$/);
  if (githubMatch?.[1]) return githubMatch[1];
  const ownerRepo = trimmed.match(/^([\w.-]+\/[\w.-]+)$/);
  if (ownerRepo?.[1]) return ownerRepo[1];
  const parts = trimmed.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || "local/repository";
}

export function normalizeGitUrl(value: string) {
  const trimmed = value.trim();
  if (/^https?:\/\//.test(trimmed) || /^git@/.test(trimmed)) return trimmed;
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) return `https://github.com/${trimmed}.git`;
  return trimmed;
}

export function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "repo"
  );
}

function gitOutput(args: string[]) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}
