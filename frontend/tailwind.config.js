import frappeUIPreset from 'frappe-ui/tailwind'

/** @type {import('tailwindcss').Config} */
export default {
  // Single design-token source for the whole suite: the frappe-ui preset
  // supplies the ink/surface/outline color tokens + spacing scale used by all
  // 7 apps. Per-app tailwind configs are dropped in favor of this one.
  presets: [frappeUIPreset],
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
    './node_modules/frappe-ui/src/components/**/*.{vue,js,ts,jsx,tsx}',
    '../node_modules/frappe-ui/src/components/**/*.{vue,js,ts,jsx,tsx}',
    './node_modules/frappe-ui/src/molecules/**/*.{vue,js,ts,jsx,tsx}',
    '../node_modules/frappe-ui/src/molecules/**/*.{vue,js,ts,jsx,tsx}',
    './node_modules/frappe-ui/frappe/components/**/*.{vue,js,ts,jsx,tsx}',
    '../node_modules/frappe-ui/frappe/components/**/*.{vue,js,ts,jsx,tsx}',
  ],
  variants: {
    extend: {
      display: ['group-hover'],
    },
  },
}
