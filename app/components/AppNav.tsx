import { NavLink } from "react-router";

const links = [
  { to: "/", label: "Home", end: true },
  { to: "/strategies", label: "Strategies", end: false },
  { to: "/backtesting", label: "Backtesting", end: false },
  { to: "/option-chain", label: "Option Chain", end: false },
] as const;

export function AppNav() {
  return (
    <nav className="mb-8 flex flex-wrap items-center gap-1 border-b border-slate-200 pb-4 dark:border-slate-800">
      <span className="mr-3 text-sm font-semibold tracking-tight text-slate-900 dark:text-white">
        Project One
      </span>
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={link.end}
          className={({ isActive }) =>
            `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              isActive
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            }`
          }
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
