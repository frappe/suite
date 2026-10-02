import frappeUIPreset, { content as frappeUIContent } from "frappe-ui/tailwind";

/** @type {import('tailwindcss').Config} */
export default {
  // Single design-token source for the whole suite: the frappe-ui preset
  // supplies the ink/surface/outline color tokens + spacing scale used by all
  // 7 apps. Per-app tailwind configs are dropped in favor of this one.
  presets: [frappeUIPreset],
  content: [
    './index.html',
    './recorder/**/*.{vue,js,ts,jsx,tsx}',
    './src/**/*.{vue,js,ts,jsx,tsx}',
    // frappe-ui's own source globs, resolved from wherever the package is
    // installed. Presets do not merge `content`, so the app must list them.
    ...frappeUIContent,
  ],
  variants: {
    extend: {
      display: ["group-hover"],
    },
  },
};
