import {
  Building2,
  CreditCard,
  FileText,
  Gauge,
  Gift,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Package,
  Percent,
  Repeat,
  Settings,
  ShieldAlert,
  Users,
  Webhook,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Marked when the underlying engine is not built yet. */
  phase?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** The navigation described in section 57 of the specification. */
export const NAV: NavGroup[] = [
  {
    label: "Billing",
    items: [
      { href: "/overview", label: "Overview", icon: LayoutDashboard },
      { href: "/customers", label: "Customers", icon: Users },
      { href: "/plans", label: "Plans", icon: Package },
      { href: "/subscriptions", label: "Subscriptions", icon: Repeat },
      { href: "/invoices", label: "Invoices", icon: FileText },
      { href: "/payments", label: "Payments", icon: CreditCard },
      { href: "/dunning", label: "Dunning", icon: ShieldAlert },
    ],
  },
  {
    label: "Metering",
    items: [
      { href: "/usage", label: "Usage", icon: Gauge, phase: "Phase 2" },
      { href: "/entitlements", label: "Entitlements", icon: ListChecks, phase: "Phase 2" },
    ],
  },
  {
    label: "Growth",
    items: [
      { href: "/coupons", label: "Coupons", icon: Percent, phase: "Phase 6" },
      { href: "/referrals", label: "Referrals", icon: Gift, phase: "Phase 6" },
    ],
  },
  {
    label: "Configuration",
    items: [
      { href: "/payment-providers", label: "Payment Providers", icon: Building2 },
      { href: "/api-keys", label: "API Keys", icon: KeyRound },
      { href: "/webhooks", label: "Webhooks", icon: Webhook },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];
