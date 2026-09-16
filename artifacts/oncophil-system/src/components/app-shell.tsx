import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import {
  Building2,
  ChevronRight,
  CircleUserRound,
  Home,
  LogOut,
  Menu,
  Package,
  ShieldCheck,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { getUserAvatar, getUserLabel, type UserRole } from '@/lib/supabase';

function initials(value: string) {
  return value
    .split(' ')
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-3" data-testid="link-brand">
      <span className="brand-mark" aria-hidden="true" />
      <span>
        <span className="block font-serif text-[1.05rem] font-extrabold tracking-tight text-sidebar-foreground">oncophil</span>
        <span className="block font-mono text-[9px] uppercase tracking-[0.2em] text-sidebar-foreground/55">operations workspace</span>
      </span>
    </Link>
  );
}

interface AppShellProps {
  role: UserRole;
  title: string;
  eyebrow: string;
  children: ReactNode;
}

export function AppShell({ role, title, eyebrow, children }: AppShellProps) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, logout } = useAuth();
  const label = getUserLabel(user);
  const avatarUrl = getUserAvatar(user);
  const isAdmin = role === 'admin';
  const basePath = isAdmin ? '/admin' : '/client';
  const navItems = [
    { href: basePath, label: 'Home', icon: Home, exact: true },
    { href: `${basePath}/profile`, label: 'Profile & access', icon: CircleUserRound, exact: false },
    ...(isAdmin
      ? [
          { href: `${basePath}/users`, label: 'User management', icon: ShieldCheck, exact: false },
          { href: `${basePath}/inventory`, label: 'Medicines & inventory', icon: Package, exact: false },
        ]
      : []),
  ];

  const sidebar = (
    <aside className="flex h-full w-[264px] shrink-0 flex-col bg-sidebar px-5 py-6 text-sidebar-foreground">
      <Brand />
      <div className="mt-10 border-y border-sidebar-border/70 py-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/45">workspace</p>
        <div className="mt-3 flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-sidebar-accent text-accent">
            {isAdmin ? <ShieldCheck size={17} /> : <Building2 size={17} />}
          </span>
          <div>
            <p className="text-sm font-semibold text-sidebar-foreground">{isAdmin ? 'Admin console' : 'Client portal'}</p>
            <p className="text-xs text-sidebar-foreground/52">{isAdmin ? 'System administration' : 'Secure account access'}</p>
          </div>
        </div>
      </div>
      <nav className="mt-7 space-y-1" aria-label={`${role} navigation`}>
        <p className="mb-3 px-3 font-mono text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/45">Navigate</p>
        {navItems.map((item) => {
          const active = item.exact ? location === item.href : location.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              className={`group flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors ${active ? 'bg-sidebar-primary font-semibold text-sidebar-primary-foreground' : 'text-sidebar-foreground/68 hover:bg-sidebar-accent hover:text-sidebar-foreground'}`}
              data-testid={`link-${item.label.toLowerCase().replaceAll(' ', '-')}`}
            >
              <span className="flex items-center gap-3"><Icon size={17} />{item.label}</span>
              <ChevronRight size={14} className={active ? 'opacity-70' : 'opacity-0 transition-opacity group-hover:opacity-50'} />
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto">
        <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/50 p-3">
          <div className="flex items-center gap-3">
            <Avatar className="size-9 border border-sidebar-border">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={`${label} profile`} />}
              <AvatarFallback className="bg-accent text-xs font-bold text-accent-foreground">{initials(label)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-sidebar-foreground" data-testid="text-sidebar-user">{label}</p>
              <p className="truncate text-xs text-sidebar-foreground/50" data-testid="text-sidebar-role">{role} account</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void logout()}
            className="mt-3 w-full justify-start gap-2 text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            data-testid="button-logout"
          >
            <LogOut size={15} /> Sign out
          </Button>
        </div>
        <p className="mt-5 px-1 font-mono text-[10px] uppercase tracking-[0.16em] text-sidebar-foreground/35">Waterfall / Linear Sequential Model · Phase 2</p>
      </div>
    </aside>
  );

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="fixed inset-y-0 left-0 z-30 hidden lg:flex">{sidebar}</div>
      {menuOpen && (
        <div className="fixed inset-0 z-40 bg-sidebar/60 lg:hidden" onClick={() => setMenuOpen(false)} aria-hidden="true">
          <div className="h-full w-[min(84vw,300px)]" onClick={(event) => event.stopPropagation()}>{sidebar}</div>
        </div>
      )}
      <div className="lg:pl-[264px]">
        <header className="sticky top-0 z-20 border-b border-border/70 bg-background/90 px-5 py-4 backdrop-blur-md sm:px-8 lg:px-10">
          <div className="mx-auto flex max-w-[1440px] items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMenuOpen(true)} data-testid="button-open-menu" aria-label="Open navigation">
                <Menu size={20} />
              </Button>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</p>
                <h1 className="mt-0.5 font-serif text-xl font-extrabold tracking-tight sm:text-2xl">{title}</h1>
              </div>
            </div>
            <div className="hidden items-center gap-3 sm:flex">
              <span className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <span className="size-1.5 rounded-full bg-emerald-500" /> secure session
              </span>
              <Link href={`${basePath}/profile`} className="rounded-full outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring" data-testid="link-header-profile">
                <Avatar className="size-9 border border-border">
                  {avatarUrl && <AvatarImage src={avatarUrl} alt={`${label} profile`} />}
                  <AvatarFallback className="bg-secondary text-xs font-bold text-secondary-foreground">{initials(label)}</AvatarFallback>
                </Avatar>
              </Link>
            </div>
            <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => void logout()} data-testid="button-mobile-logout" aria-label="Sign out">
              <LogOut size={18} />
            </Button>
          </div>
        </header>
        <main className="mx-auto max-w-[1440px] px-5 py-8 sm:px-8 sm:py-10 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
