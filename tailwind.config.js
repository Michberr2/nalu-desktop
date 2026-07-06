/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Exact Nalu (train) workspace tokens — see globals.css.
        glass: 'rgb(var(--ws-glass) / <alpha-value>)',
        ink: 'rgb(var(--ws-ink) / <alpha-value>)',
        dim: 'rgb(var(--ws-dim) / <alpha-value>)',
        canvas: 'rgb(var(--ws-canvas) / <alpha-value>)',
        panel: 'rgb(var(--ws-panel) / <alpha-value>)',
        panel2: 'rgb(var(--ws-panel2) / <alpha-value>)',
        sidebar: 'rgb(var(--ws-sidebar) / <alpha-value>)',
        accent: 'rgb(var(--ws-accent) / <alpha-value>)',
        gold: 'rgb(var(--ws-accent) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0', transform: 'scale(0.98)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
      },
      animation: { fadeIn: 'fadeIn 0.25s ease-out' },
    },
  },
  plugins: [],
}
