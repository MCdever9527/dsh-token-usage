/**
 * Build the two halves of dsh-token-usage.
 *
 *   lib/index.js   host half   — Node ESM cordis plugin
 *   lib/client.js  client half — CJS factory bundle for window.__ModuleLoader__
 *
 * Neither half imports a @deepseek-ai/* platform package statically: the
 * profile's junction farm for them is dangling in a desktop install. The only
 * shared-module imports of the client half (React and the settings
 * primitives) stay external and come from the page's module table.
 *
 * This script drives the esbuild CLI with inherited stdio rather than the JS
 * API: inside a confined DSH session the JS API cannot spawn the service binary
 * (its stdio is piped, and pipes are denied), while an inherited-stdio child
 * runs normally.
 *
 * `--tests` additionally compiles tests/*.spec.ts into .tmp-test/*.test.mjs so
 * the runner can import them directly without a test framework.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { localModuleRoots } from './tools/local-paths.mjs'

const root = dirname(fileURLToPath(import.meta.url))
// The test suite is a local-only asset and is not published with this package,
// so `--tests` in a checkout that has none is a skip, not a failure.
const testsRequested = process.argv.includes('--tests')
const withTests = testsRequested && existsSync(join(root, 'tests'))
if (testsRequested && !withTests) {
  console.log('build: --tests requested, but tests/ is not in this checkout; skipping the test build')
}

/** Platform packages esbuild publishes its executable in. */
const PLATFORM_PACKAGES = [
  '@esbuild/win32-x64',
  '@esbuild/linux-x64',
  '@esbuild/darwin-arm64',
  '@esbuild/darwin-x64',
]

/**
 * Resolve an esbuild executable without assuming a network install: this plugin
 * is developed offline against the DSH desktop bundle, so a sibling checkout's
 * node_modules is an accepted fallback. `npm install` in this package (or
 * DSH_ESBUILD=/path/to/esbuild[.exe]) always wins.
 * @returns absolute path of the esbuild executable.
 */
function resolveEsbuild() {
  const explicit = process.env.DSH_ESBUILD
  if (typeof explicit === 'string' && explicit.length > 0 && existsSync(explicit)) return explicit

  const nodeModulesRoots = [
    join(root, 'node_modules'),
    resolve(root, '..', 'dsh-model-fields', 'node_modules'),
    resolve(root, '..', 'dsh-mcp-tools', 'node_modules'),
    ...localModuleRoots(),
  ]
  for (const modules of nodeModulesRoots) {
    for (const pkg of PLATFORM_PACKAGES) {
      const candidate = join(
        modules,
        ...pkg.split('/'),
        process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild',
      )
      if (existsSync(candidate)) return candidate
    }
  }
  throw new Error(
    'esbuild not found: run `npm install` in dsh-token-usage, or set DSH_ESBUILD to the esbuild executable',
  )
}

const executable = resolveEsbuild()
console.log(`esbuild: ${executable}`)

/** Run one esbuild CLI invocation; throws with the exit status on failure. */
function esbuild(args) {
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`esbuild failed with exit code ${String(result.status ?? 'null')}`)
}

const sharedDefine = [
  `--define:process.env.NODE_ENV=${JSON.stringify(process.env.NODE_ENV ?? 'production')}`,
  `--define:import.meta.env.MODE=${JSON.stringify(process.env.NODE_ENV ?? 'production')}`,
]

mkdirSync(join(root, 'lib'), { recursive: true })

// Host half: ESM for Node. Nothing platform-provided is imported statically, so
// there is no external list beyond Node's own builtins.
esbuild([
  'src/index.ts',
  '--bundle',
  '--format=esm',
  '--platform=node',
  '--target=es2023',
  '--outfile=lib/index.js',
  '--sourcemap',
  '--log-level=info',
])

// Client half: the CJS factory the module loader expects. The factory id must
// equal the package name, because that is how the loader pairs a browser half
// with the Loader row whose specifier is this package.
const banner =
  'window.__ModuleLoader__.load({ id: "dsh-token-usage", factory: (require) => { var module = { exports: {} };'
const footer = 'return module.exports; } });'
esbuild([
  'src/client/index.tsx',
  '--bundle',
  '--format=cjs',
  '--platform=browser',
  '--target=es2022',
  '--jsx=automatic',
  '--outfile=lib/client.js',
  '--external:react',
  '--external:react/jsx-runtime',
  '--external:react-dom',
  '--external:react-dom/client',
  '--external:@deepseek-ai/cordis',
  '--external:@deepseek-ai/dsh-client-store',
  '--external:@deepseek-ai/dsh-client-ui-slots',
  '--external:@deepseek-ai/dsh-client-ui-primitives',
  '--external:@deepseek-ai/dsh-client-runtime/client',
  ...sharedDefine,
  `--banner:js=${banner}`,
  `--footer:js=${footer}`,
  '--sourcemap',
  '--log-level=info',
])

if (withTests) {
  mkdirSync(join(root, '.tmp-test'), { recursive: true })
  esbuild([
    'tests/fold.spec.ts',
    'tests/log-file.spec.ts',
    'tests/range.spec.ts',
    'tests/snapshot.spec.ts',
    '--bundle',
    '--format=esm',
    '--platform=node',
    '--target=es2023',
    '--outdir=.tmp-test',
    '--out-extension:.js=.test.mjs',
    '--sourcemap=inline',
    '--log-level=info',
  ])
  console.log('built .tmp-test/*.test.mjs')
}

console.log('built lib/index.js and lib/client.js')
