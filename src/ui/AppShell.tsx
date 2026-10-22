import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { ChevronsUpDown, LogOut, Menu, Settings, X } from "lucide-react";
import { useAuth, useSession } from "./auth";
import type { Brand, NavItem } from "./brand";
import { cn } from "./cn";
import { api } from "./api";

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-ui px-3 py-2 text-sm font-medium transition-colors",
              isActive ? "bg-brand-soft text-brand-ink" : "text-muted hover:bg-surface-2 hover:text-fg",
            )
          }
        >
          <item.icon className="size-4.5 shrink-0" aria-hidden="true" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

function AccountBlock({ onNavigate }: { onNavigate?: () => void }) {
  const session = useSession();
  const { signOut, setSession } = useAuth();
  const navigate = useNavigate();
  const isFree = session.org.plan === "free";

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      {session.orgs.length > 1 ? (
        <label className="relative block">
          <span className="sr-only">Switch organization</span>
          <select
            className="h-9 w-full appearance-none rounded-ui border border-line bg-surface pr-8 pl-3 text-sm"
            value={session.org.id}
            onChange={async (e) => {
              const next = await api.post<typeof session>("/api/auth/switch-org", { orgId: e.target.value });
              setSession(next);
              navigate("/app");
            }}
          >
            {session.orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <ChevronsUpDown className="pointer-events-none absolute top-2.5 right-2.5 size-4 text-muted" />
        </label>
      ) : (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{session.org.name}</p>
          <p className="text-xs text-muted capitalize">{session.org.plan} plan</p>
        </div>
      )}
      {isFree ? (
        <Link
          to="/app/settings/billing"
          onClick={onNavigate}
          className="rounded-ui border border-brand/30 bg-brand-soft px-3 py-2 text-xs font-medium text-brand-ink hover:border-brand/60"
        >
          You're on the free plan. See paid plans →
        </Link>
      ) : null}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{session.user.name}</p>
          <p className="truncate text-xs text-muted">{session.user.email}</p>
        </div>
        <Link
          to="/app/settings"
          onClick={onNavigate}
          className="rounded-ui p-2 text-muted hover:bg-surface-2 hover:text-fg"
          aria-label="Settings"
          title="Settings"
        >
          <Settings className="size-4" />
        </Link>
        <button
          type="button"
          onClick={async () => {
            await signOut();
            navigate("/login");
          }}
          className="rounded-ui p-2 text-muted hover:bg-surface-2 hover:text-fg"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );
}

/** Signed-in layout: sidebar on wide screens, top bar with a slide-in menu on phones. */
export function AppShell({ brand, nav }: { brand: Brand; nav: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-line bg-surface px-4 py-5 lg:flex">
        <Link to="/app" className="px-2">
          {brand.logo}
        </Link>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NavList items={nav} />
        </div>
        <AccountBlock />
      </aside>

      <header
        className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/95 py-3 backdrop-blur lg:hidden"
        style={{
          paddingLeft: "max(16px, env(safe-area-inset-left))",
          paddingRight: "max(16px, env(safe-area-inset-right))",
        }}
      >
        <Link to="/app">{brand.logo}</Link>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-ui p-2 text-fg hover:bg-surface-2"
          aria-label="Open menu"
          aria-expanded={open}
        >
          <Menu className="size-5" />
        </button>
      </header>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-[min(320px,88vw)] flex-col gap-6 bg-surface px-4 py-5 shadow-xl">
            <div className="flex items-center justify-between px-2">
              {brand.logo}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-ui p-2 text-muted hover:bg-surface-2"
                aria-label="Close menu"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <NavList items={nav} onNavigate={() => setOpen(false)} />
            </div>
            <AccountBlock onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}

      <main
        className="mx-auto w-full max-w-6xl py-6 sm:py-8"
        style={{
          paddingLeft: "max(16px, env(safe-area-inset-left))",
          paddingRight: "max(16px, env(safe-area-inset-right))",
        }}
      >
        <div className="lg:px-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
