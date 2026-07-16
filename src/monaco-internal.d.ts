declare module 'monaco-editor/esm/vs/editor/common/languages/supports/tokenization.js' {
  export function generateTokensCSSForColorMap(colorMap: unknown[]): string
}

declare module 'monaco-editor/esm/vs/base/common/color.js' {
  export const Color: {
    Format: {
      CSS: {
        parseHex(value: string): unknown
      }
    }
  }
}
