export type OfficeOpen = boolean

declare module 'claude-code' {
  interface PluginState {
    'office-space': { open: boolean; selected: string }
  }
}
