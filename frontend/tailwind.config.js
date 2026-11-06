/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'trakend': {
          'dark': 'var(--color-bg-primary, #1e2128)',
          'darker': 'var(--color-bg-darker, #171a1f)',
          'surface': 'var(--color-bg-secondary, #252830)',
          'surface-light': 'var(--color-surface, #2e3240)',
          'border': 'var(--color-border, #363a48)',
          'text-primary': 'var(--color-text-primary, #e2e4e9)',
          // 4.5:1+ against both surface (#252830) and surface-light (#2e3240)
          'text-secondary': 'var(--color-text-secondary, #9ea3b8)',
          'text-muted': 'var(--color-text-muted, #7d8296)',
          'accent': 'var(--color-accent, #2ab5b2)',
          'accent-dark': 'var(--color-accent-dark, #229e9b)',
          'accent-light': 'var(--color-accent-light, #3ec9c6)',
          'success': 'var(--color-success, #00d4aa)',
          'warning': 'var(--color-warning, #ffa502)',
          'error': 'var(--color-error, #ff3860)',
          'info': 'var(--color-info, #3273dc)',
          // readable variant of info for text on dark surfaces
          'info-light': 'var(--color-info-light, #6ea0ff)',
        },
      },
      spacing: {
        // 8px scale helpers (Tailwind's default 2/4/6/8 already map to 8/16/24/32px)
        'sidebar': '16rem',
        'topbar': '3rem',
      },
      fontFamily: {
        mono: [
          '"JetBrainsMono Nerd Font"', '"JetBrains Mono"', '"FiraCode Nerd Font"', '"Fira Code"',
          '"Cascadia Code"', '"SF Mono"', 'Menlo', 'Monaco', 'Consolas', '"DejaVu Sans Mono"',
          '"Liberation Mono"', '"Courier New"', 'monospace',
        ],
      },
      screens: {
        'lg': '1024px',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
  darkMode: 'class',
}
