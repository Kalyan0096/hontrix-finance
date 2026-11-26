/** Small stroke icon set (24px grid). Decorative: always paired with a text label. */
const P: Record<string, string> = {
  dashboard: "M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z",
  alerts: "M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Zm4 9a2 2 0 0 0 4 0",
  payments: "M4 7h16v11H4V7Zm0 4h16M15 15h2M7 4l10 0",
  assistant: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Zm7 11l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z",
  customers: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9c0-3.3 2.7-6 6-6s6 2.7 6 6M17 11a3 3 0 1 0 0-6m1 9c2.2.4 4 2.3 4 5",
  vehicles: "M5 16V11l2-5h10l2 5v5M3 16h18v2H3v-2Zm3-3h.01M18 13h.01M7 11h10",
  loans: "M7 3h8l4 4v14H7V3Zm8 0v4h4M10 12h6M10 16h6",
  documents: "M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z",
  reports: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  employees: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9c0-3.9 3.1-7 7-7s7 3.1 7 7",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3c0-.5 0-.9-.1-1.3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.2-1.3L14.3 3h-4l-.4 2.4A7.6 7.6 0 0 0 7.7 6.7l-2.4-1-2 3.4 2 1.6a7.800 7.800 0 0 0 0 2.600l-2 1.600 2 3.400 2.400-1c.7.600 1.400 1 2.200 1.300l.4 2.500h4l.4-2.500c.8-.3 1.500-.7 2.200-1.300l2.400 1 2-3.400-2-1.600c.1-.4.100-.9.100-1.300Z",
  import: "M12 16V4m0 0L7 9m5-5l5 5M4 16v4h16v-4",
  audit: "M12 3l8 3v6c0 4.500-3.200 8-8 9-4.800-1-8-4.500-8-9V6l8-3Zm-3 9l2.500 2.500L16 10",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  close: "M6 6l12 12M18 6L6 18",
  account: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 9c0-4 3.600-7 8-7s8 3 8 7",
  signout: "M15 4h4v16h-4M10 8l-4 4 4 4m-4-4h10",
  language: "M3 5h8M7 3v2m0 0c0 4-2 7-5 8m3-4c1 2 3 4.500 6 5.500M13 21l4-10 4 10m-1.500-4h-5",
  rupee: "M7 5h10M7 9h10M7 5c5 0 7 1.500 7 4s-2 4-7 4h-.5l7.500 6",
};

export type IconName = keyof typeof P;

export function Icon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={P[name] ?? P.dashboard} />
    </svg>
  );
}

/** Brand mark: a ledger page with a rupee stroke. */
export function BrandMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={className}>
      <rect width="40" height="40" rx="10" fill="#e3a008" />
      <path d="M12 11h16M12 16h16M12 11c7 0 10 2 10 5.500s-3 5.500-10 5.500h-.5L24 30" fill="none" stroke="#0b2a25" strokeWidth="2.600" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
