import type { Metadata } from 'next';
import { Exo_2, JetBrains_Mono, Unbounded } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/common/Providers';
import { Header } from '@/components/common/Header';
import { Footer } from '@/components/common/Footer';

const exo = Exo_2({ subsets: ['latin', 'cyrillic'], variable: '--font-exo', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin', 'cyrillic'], variable: '--font-jetbrains', display: 'swap' });
const unbounded = Unbounded({ subsets: ['latin', 'cyrillic'], variable: '--font-unbounded', display: 'swap' });

export const metadata: Metadata = {
  title: 'JK-MARKET.UZ | Интернет-магазин ПК, 3D Конструктор и Расчет FPS',
  description: 'Купить компьютерные комплектующие в Ташкенте. Интерактивный 3D конфигуратор ПК с проверкой совместимости и калькулятором FPS в 20 тяжелых играх.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className={`dark h-full ${exo.variable} ${mono.variable} ${unbounded.variable}`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col text-slate-900 dark:text-cyan-50 selection:bg-cyan-400 selection:text-black transition-colors duration-200">
        <div className="cyber-bg" aria-hidden>
          <div className="cyber-orb bg-cyan-500 -top-40 -left-40" />
          <div className="cyber-orb bg-fuchsia-600 top-1/3 -right-60 [animation-delay:-6s]" />
        </div>
        <Providers>
          <Header />
          <main className="flex-1 relative">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
