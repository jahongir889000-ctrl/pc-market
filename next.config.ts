import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Публичное имя Telegram-бота (не секрет) — нужно клиентской странице корзины
  env: {
    NEXT_PUBLIC_TELEGRAM_BOT_USERNAME: (process.env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, ""),
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
