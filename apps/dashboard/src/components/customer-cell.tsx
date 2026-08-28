/**
 * Who the customer is, with your own id underneath it.
 *
 * The lists used to show only the external id, which is right for a developer
 * chasing one record and wrong for everybody else — a screen full of
 * `co_benin` tells a finance lead nothing about who is behind on payment. The
 * name leads; the id stays, because it is the handle you paste into your own
 * system.
 */
export function CustomerCell({
  customer,
}: {
  customer?: { externalId?: string | null; email?: string | null; name?: string | null } | null;
}) {
  if (!customer) return <>—</>;

  const label = customer.name ?? customer.email ?? customer.externalId ?? "—";
  const secondary = customer.name ? (customer.externalId ?? customer.email) : customer.externalId;

  return (
    <span className="block">
      <span className="block truncate">{label}</span>
      {secondary ? (
        <span className="block truncate font-mono text-xs text-muted-foreground">{secondary}</span>
      ) : null}
    </span>
  );
}
