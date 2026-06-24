export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg)/<alpha-value>)',
        surface: 'rgb(var(--surface)/<alpha-value>)',
        surface2: 'rgb(var(--surface2)/<alpha-value>)',
        line: 'rgb(var(--line)/<alpha-value>)',
        txt: 'rgb(var(--txt)/<alpha-value>)',
        muted: 'rgb(var(--muted)/<alpha-value>)',
        brand: 'rgb(var(--brand)/<alpha-value>)',
        ok: 'rgb(var(--ok)/<alpha-value>)',
        warn: 'rgb(var(--warn)/<alpha-value>)',
        bad: 'rgb(var(--bad)/<alpha-value>)',
        violet: 'rgb(var(--violet)/<alpha-value>)',
      },
    },
  },
  plugins: [],
}
