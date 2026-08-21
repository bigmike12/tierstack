"use client";

import { useTransition } from "react";
import { switchOrganization } from "@/actions/session";
import type { Organization } from "@/lib/types";

export function OrgSwitcher({
  organizations,
  currentId,
}: {
  organizations: Organization[];
  currentId: string;
}) {
  const [pending, startTransition] = useTransition();

  if (organizations.length === 0) return null;

  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">Organization</span>
      <select
        defaultValue={currentId}
        disabled={pending || organizations.length === 1}
        onChange={(event) => {
          const next = event.target.value;
          startTransition(() => void switchOrganization(next));
        }}
        className="h-8 max-w-[220px] truncate rounded-md border border-input bg-card px-2 text-sm disabled:opacity-100"
      >
        {organizations.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
            {org.role ? ` · ${org.role.toLowerCase()}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
