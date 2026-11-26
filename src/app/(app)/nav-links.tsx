"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "./icons";

export interface NavItem { href: string; label: string; icon: string; badge?: ReactNode }
export interface NavGroup { title?: string; items: NavItem[] }

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

/** Desktop sidebar navigation, grouped. */
export function SideNav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  return (
    <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
      {groups.map((g, gi) => (
        <div key={gi} className={gi ? "mt-5" : ""}>
          {g.title ? <p className="px-3 pb-1.5 text-xs font-medium text-white/50">{g.title}</p> : null}
          <ul className="space-y-0.5">
            {g.items.map((i) => {
              const active = isActive(path, i.href);
              return (
                <li key={i.href}>
                  <Link href={i.href} aria-current={active ? "page" : undefined}
                    className={`group relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] font-medium transition-colors ${active ? "bg-white/12 text-white" : "text-white/72 hover:bg-white/8 hover:text-white"}`}>
                    {active ? <span className="absolute -left-3 top-2 bottom-2 w-1 rounded-r bg-mark" aria-hidden="true" /> : null}
                    <Icon name={i.icon} className={`h-5 w-5 shrink-0 ${active ? "text-mark" : "text-white/55 group-hover:text-white/80"}`} />
                    <span className="flex-1">{i.label}</span>
                    {i.badge}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Phone navigation: four everyday screens in a bottom bar, everything else in a full-screen "More" sheet. */
export function MobileNav({ primary, groups, moreLabel, closeLabel, footer }: { primary: NavItem[]; groups: NavGroup[]; moreLabel: string; closeLabel: string; footer: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);
  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-pine-deep pb-[env(safe-area-inset-bottom)] print:hidden md:hidden" aria-label="Main">
        <ul className="grid grid-cols-5">
          {primary.map((i) => {
            const active = isActive(path, i.href);
            return (
              <li key={i.href}>
                <Link href={i.href} aria-current={active ? "page" : undefined} className={`relative flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium ${active ? "text-white" : "text-white/65"}`}>
                  {active ? <span className="absolute inset-x-5 top-0 h-0.5 rounded-b bg-mark" aria-hidden="true" /> : null}
                  <span className="relative"><Icon name={i.icon} className={`h-6 w-6 ${active ? "text-mark" : ""}`} />{i.badge ? <span className="absolute -right-2.5 -top-1.5">{i.badge}</span> : null}</span>
                  <span className="max-w-full truncate px-1">{i.label}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={() => setOpen(true)} aria-expanded={open} aria-haspopup="dialog" className="flex min-h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium text-white/65">
              <Icon name="more" className="h-6 w-6" /><span>{moreLabel}</span>
            </button>
          </li>
        </ul>
      </nav>
      {open ? (
        <div role="dialog" aria-modal="true" aria-label={moreLabel} className="fixed inset-0 z-40 flex flex-col bg-pine-deep text-white md:hidden print:hidden">
          <div className="flex items-center justify-between px-5 py-4">
            <p className="text-lg font-semibold">{moreLabel}</p>
            <button type="button" onClick={() => setOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-white/10" aria-label={closeLabel}><Icon name="close" className="h-6 w-6" /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-6">
            {groups.map((g, gi) => (
              <div key={gi} className="mb-5">
                {g.title ? <p className="px-2 pb-2 text-sm text-white/55">{g.title}</p> : null}
                <ul className="grid grid-cols-2 gap-2">
                  {g.items.map((i) => (
                    <li key={i.href}>
                      <Link href={i.href} className="flex min-h-14 items-center gap-3 rounded-xl bg-white/8 px-4 font-medium active:bg-white/15">
                        <Icon name={i.icon} className="h-5 w-5 text-mark" /><span className="flex-1">{i.label}</span>{i.badge}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="mt-2 grid gap-2 border-t border-white/10 pt-4">{footer}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}
