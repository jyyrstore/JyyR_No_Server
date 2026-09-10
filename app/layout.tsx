import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: "Jyy'R Number Server",
  description: 'Virtual Numbers, inbound SMS, API infrastructure and webhooks.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body>{children}</body></html>;
}
