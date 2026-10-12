/**
 * Local structural shims for the platform modules this plugin touches.
 *
 * Why they exist: the DSH SDK packages are resolved by the profile's own runtime
 * table at load time and cannot be installed in this offline checkout, so
 * `tsc --noEmit` would otherwise fail on every import. Each declaration below
 * describes exactly the surface this plugin uses and nothing more — they are
 * intentionally permissive and never substitute for the real contracts.
 *
 * React types come from @types/react through the fallback checkout that
 * tools/tsc.mjs wires up; only the settings primitives are shimmed here.
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ComponentType } from 'react'
  /** The shared button primitive of the settings chrome. */
  export const Button: ComponentType<{
    onClick?: () => void
    children?: unknown
    disabled?: boolean
  }>
}
