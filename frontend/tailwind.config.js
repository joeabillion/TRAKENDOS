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
          'dark': '#1a1a1a',
          'darker': '#0f0f0f',
          'surface': '#2a2a2a',
          'surface-light': '#3a3a3a',
          'border': '#444444',
          'text-primary': '#e5e5e5',
          'text-secondary': '#a0a0a0',
          'accent': '#ff6b35',
          'accent-dark': '#e55a24',
          'accent-light': '#ff8c5a',
          'success': '#00d4aa',
          'warning': '#ffa502',
          'error': '#ff3860',
          'info': '#3273dc',
        },
      },
      backgroundColor: {
        'primary': 'var(--color-bg-primary, #1a1a1a)',
        'secondary': 'var(--color-bg-secondary, #2a2a2a)',
        'accent': 'var(--color-accent, #ff6b35)',
      },
      textColor: {
        'primary': 'var(--color-text-primary, #e5e5e5)',
        'secondary': 'var(--color-text-secondary, #a0a0a0)',
        'accent': 'var(--color-accent, #ff6b35)',
      },
      borderColor: {
        'primary': 'var(--color-border, #444444)',
      },
    },
  },
  plugins: [],
  darkMode: 'class',
}
