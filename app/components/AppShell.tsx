import { useEffect, useId, useState } from "react";
import { NavLink, useLocation } from "react-router";

const links = [
  { to: "/", label: "Market Watch", hint: "Live index quotes", end: true },
  { to: "/strategies", label: "Playbook", hint: "Live setups", end: false },
  { to: "/paper", label: "Paper", hint: "Simulated trades", end: false },
  { to: "/backtesting", label: "Backtesting", hint: "Historical runs", end: false },
  { to: "/option-chain", label: "Option Chain", hint: "Strikes and OI", end: false },
  { to: "/settings", label: "Settings", hint: "Dhan token", end: false },
] as const;

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="h-5 w-5"
      aria-hidden
    >
      {open ? (
        <>
          <path d="M6 6l12 12" />
          <path d="M18 6L6 18" />
        </>
      ) : (
        <>
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        </>
      )}
    </svg>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex h-full flex-col">
      <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
        <p className="text-sm font-semibold tracking-tight text-slate-900 dark:text-white">
          Project One
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">Index lab</p>
      </div>
      <ul className="flex-1 space-y-1 p-3">
        {links.map((link) => (
          <li key={link.to}>
            <NavLink
              to={link.to}
              end={link.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                `block rounded-xl px-3 py-2.5 transition ${
                  isActive
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className="block text-sm font-medium">{link.label}</span>
                  <span
                    className={`mt-0.5 block text-[11px] ${
                      isActive
                        ? "text-white/70 dark:text-slate-500"
                        : "text-slate-400"
                    }`}
                  >
                    {link.hint}
                  </span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const panelId = useId();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="min-h-screen md:pl-60">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-3 py-3 backdrop-blur md:hidden dark:border-slate-800 dark:bg-gray-950/90">
        <button
          type="button"
          className="rounded-lg p-2 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          <MenuIcon open={open} />
          <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
        </button>
        <p className="text-sm font-semibold text-slate-900 dark:text-white">
          Project One
        </p>
      </header>

      {open ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-slate-950/40 md:hidden"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        id={panelId}
        className={`fixed inset-y-0 left-0 z-50 w-60 border-r border-slate-200 bg-white transition-transform duration-200 dark:border-slate-800 dark:bg-gray-950 ${
          open ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0`}
      >
        <SidebarNav onNavigate={() => setOpen(false)} />
      </aside>

      {children}
    </div>
  );
}
