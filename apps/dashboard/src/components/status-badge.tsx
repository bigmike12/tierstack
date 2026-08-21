import { Badge } from "@/components/ui/badge";
import { titleCase } from "@/lib/format";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const SUBSCRIPTION_TONES: Record<string, Tone> = {
  ACTIVE: "success",
  TRIALING: "info",
  INCOMPLETE: "neutral",
  PAST_DUE: "warning",
  GRACE_PERIOD: "warning",
  PAUSED: "neutral",
  UNPAID: "danger",
  CANCELED: "neutral",
  EXPIRED: "neutral",
};

const INVOICE_TONES: Record<string, Tone> = {
  PAID: "success",
  OPEN: "warning",
  DRAFT: "neutral",
  VOID: "neutral",
  UNCOLLECTIBLE: "danger",
};

const ATTEMPT_TONES: Record<string, Tone> = {
  SUCCEEDED: "success",
  PENDING: "info",
  PROCESSING: "info",
  FAILED: "danger",
  CANCELED: "neutral",
};

const WEBHOOK_TONES: Record<string, Tone> = {
  PROCESSED: "success",
  RECEIVED: "info",
  PROCESSING: "info",
  FAILED: "danger",
  IGNORED: "neutral",
};

const ALL = { ...SUBSCRIPTION_TONES, ...INVOICE_TONES, ...ATTEMPT_TONES, ...WEBHOOK_TONES };

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={ALL[status] ?? "neutral"}>{titleCase(status)}</Badge>;
}
