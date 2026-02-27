import type { Metadata } from 'next';
import { ThemeProvider } from 'next-themes';
import './globals.css';

export const metadata: Metadata = {
  title: 'Flight Points - Award Flight Deals',
  description: 'Find the best award flight deals across all loyalty programs',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <header className="border-b border-border">
            <nav className="container mx-auto px-4 h-14 flex items-center gap-6">
              <a href="/" className="text-lg font-bold text-primary">Flight Points</a>
              <a href="/search" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Search</a>
              <a href="/deals" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Deals</a>
            </nav>
          </header>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
