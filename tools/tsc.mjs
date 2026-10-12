/**
 * Type-check the sources.
 *
 * Types for the `@deepseek-ai/*` SDK are not installable in this offline
 * checkout, so this project ships local structural shims (types/dsh-sdk.d.ts)
 * instead of the published d.ts files; the shims describe exactly the surface
 * this plugin touches. TypeScript, @types/node and @types/react are resolved
 * the same way esbuild is: this package's own node_modules first, then a
 * sibling checkout. When the fallback is what answered, this script writes a
 * throwaway tsconfig that adds typeRoots and paths for it, so the committed
 * tsconfig stays portable and a normal `npm install` needs none of it.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { localModuleRoots } from './local-paths.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(root, '..')
const require = createRequire(import.meta.url)

/** Offline fallback checkouts, in the order they are tried. */
const FALLBACK_MODULES = [
  resolve(projectRoot, '..', 'dsh-session-manager', 'node_modules'),
  ...localModuleRoots(),
]

/** Find a usable tsc, preferring this package's own install. */
function resolveTsc() {
  const candidates = [
    process.env.DSH_TSC,
    join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
    ...FALLBACK_MODULES.map((modules) => join(modules, 'typescript', 'bin', 'tsc')),
  ].filter((value) => typeof value === 'string' && value.length > 0)
  for (const candidate of candidates) {
    try {
      return require.resolve(candidate)
    } catch {
      /* try the next one */
    }
  }
  return undefined
}

/**
 * Pick the module root that supplies the ambient types.
 * @returns the directory, or undefined when this package has its own install.
 */
function resolveTypesRoot() {
  if (existsSync(join(projectRoot, 'node_modules', '@types', 'node'))) return undefined
  for (const modules of FALLBACK_MODULES) {
    if (existsSync(join(modules, '@types', 'node'))) return modules
  }
  return undefined
}

const tsc = resolveTsc()
if (tsc === undefined) {
  console.log('tsc not found (install typescript or set DSH_TSC); skipping typecheck')
  process.exit(0)
}

const typesRoot = resolveTypesRoot()
const tsconfig = join(projectRoot, 'tsconfig.json')
const scratchConfig = join(projectRoot, '.tsconfig.check.json')
try {
  let configPath = tsconfig
  if (typesRoot !== undefined) {
    writeFileSync(
      scratchConfig,
      JSON.stringify(
        {
          extends: './tsconfig.json',
          compilerOptions: {
            typeRoots: [join(typesRoot, '@types')],
            paths: {
              react: [join(typesRoot, '@types', 'react')],
              'react/jsx-runtime': [join(typesRoot, '@types', 'react', 'jsx-runtime')],
              'react-dom': [join(typesRoot, '@types', 'react-dom')],
              'react-dom/client': [join(typesRoot, '@types', 'react-dom', 'client')],
            },
          },
        },
        null,
        2,
      ) + '\n',
    )
    configPath = scratchConfig
  }
  const result = spawnSync(process.execPath, [tsc, '--noEmit', '-p', configPath], { cwd: projectRoot, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  // `process.exitCode` rather than `process.exit`: the scratch config is removed
  // by the `finally` below, and `process.exit` would skip it and leave a file
  // naming this machine's absolute paths in the repository root.
  process.exitCode = result.status ?? 0
} finally {
  if (existsSync(scratchConfig)) rmSync(scratchConfig, { force: true })
}
