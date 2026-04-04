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
          'text-secondary': 'var(--color-text-secondary, #8b8fa3)',
          'accent': 'var(--color-accent, #2ab5b2)',
          'accent-dark': 'var(--color-accent-dark, #229e9b)',
          'accent-light': 'var(--color-accent-light, #3ec9c6)',
          'success': 'var(--color-success, #00d4aa)',
          'warning': 'var(--color-warning, #ffa502)',
          'error': 'var(--color-error, #ff3860)',
          'info': 'var(--color-info, #3273dc)',
        },
      },
    },
  },
  plugins: [],
  darkMode: 'class',
}
