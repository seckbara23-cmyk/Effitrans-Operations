import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Deep ocean navy — Port of Dakar at night, primary brand
        navy: {
          50: "#eef2f7",
          100: "#d3dce8",
          200: "#a7b9d1",
          300: "#7090b5",
          400: "#456a93",
          500: "#2b4d72",
          600: "#1d3a59",
          700: "#142a42",
          800: "#0e2032",
          900: "#0B1F33",
          950: "#06121f",
        },
        // Port teal — water, maritime, secondary
        teal: {
          50: "#effaf7",
          100: "#cbf0e7",
          200: "#98e0d1",
          300: "#5fc8b6",
          400: "#33a896",
          500: "#188a79",
          600: "#0F766E",
          700: "#0c5d58",
          800: "#0d4a47",
          900: "#0d3e3c",
          950: "#022422",
        },
        // Warm amber/gold — customs stamps, Teranga warmth, accent
        amber: {
          50: "#fdf6ec",
          100: "#fae6c9",
          200: "#f4cb8e",
          300: "#edab54",
          400: "#e8912f",
          500: "#D97706",
          600: "#bd5e04",
          700: "#9c4509",
          800: "#7f380e",
          900: "#6a300f",
          950: "#3d1804",
        },
        // Sand / off-white — document paper, backgrounds
        sand: {
          50: "#fdfbf6",
          100: "#F7F3EA",
          200: "#efe7d4",
          300: "#e2d4b5",
          400: "#d0ba8e",
          500: "#bfa06d",
          600: "#a9875a",
          700: "#8c6e4c",
          800: "#735a42",
          900: "#5f4b39",
        },
        // Slate neutral
        slate: {
          50: "#f6f7f9",
          100: "#eceef2",
          200: "#d5dae2",
          300: "#b0bac9",
          400: "#8593a9",
          500: "#64748b",
          600: "#516076",
          700: "#424e60",
          800: "#3a4351",
          900: "#343b46",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(11, 31, 51, 0.04), 0 4px 16px rgba(11, 31, 51, 0.06)",
        "card-hover":
          "0 2px 4px rgba(11, 31, 51, 0.06), 0 8px 28px rgba(11, 31, 51, 0.10)",
      },
      backgroundImage: {
        // Subtle nautical chart / shipping-route grid
        "chart-grid":
          "linear-gradient(rgba(15, 118, 110, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(15, 118, 110, 0.05) 1px, transparent 1px)",
        // Faint diagonal "container" hatch for hero surfaces
        "container-hatch":
          "repeating-linear-gradient(135deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 1px, transparent 1px, transparent 14px)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.3s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
