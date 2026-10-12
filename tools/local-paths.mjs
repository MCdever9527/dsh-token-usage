/**
 * Machine-local paths for the build, typecheck and smoke tools.
 *
 * esbuild, TypeScript and the `@types` packages are not installed by this
 * package: it is developed offline against sibling checkouts, so the tools that
 * need them accept extra `node_modules` roots from an optional, git-ignored
 * `.dsh-local.json` at the repository root:
 *
 *   {
 *     "moduleRoots": ["D:/some/checkout/node_modules"],
 *     "desktopExe": "D:/some/install/DeepSeek Harness.exe"
 *   }
 *
 * Every field is optional, and a missing or unreadable file simply means no
 * overrides — a fresh clone is unaffected and installs its own dependencies.
 * The `DSH_ESBUILD`, `DSH_TSC` and `DSH_DESKTOP_EXE` environment variables win
 * over this file.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root, one level above this file. */
export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The optional local config; a missing or invalid file yields an empty object. */
export function localConfig() {
  try {
    const parsed = JSON.parse(readFileSync(join(projectRoot, '.dsh-local.json'), 'utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** Extra `node_modules` roots to search after this package's own install. */
export function localModuleRoots() {
  const roots = localConfig().moduleRoots
  if (!Array.isArray(roots)) return []
  return roots.filter((value) => typeof value === 'string' && value.length > 0)
}

/** The desktop executable the host smoke test loads, when it is configured here. */
export function localDesktopExe() {
  const value = localConfig().desktopExe
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
