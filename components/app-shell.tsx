import { Sidebar } from './sidebar';
import { MobileNav } from './mobile-nav';
export function AppShell({ children }: { children: React.ReactNode }) { return <div className="shell"><div className="mx-auto flex max-w-7xl gap-4 px-4 py-4 lg:px-6"><Sidebar/><main className="min-w-0 flex-1"><MobileNav/>{children}</main></div></div>; }
