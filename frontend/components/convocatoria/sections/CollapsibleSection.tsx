"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function CollapsibleSection({
  title,
  subtitle,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="surface overflow-hidden p-0"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 hover:bg-paperDeep">
        {icon && <span className="shrink-0 text-clay">{icon}</span>}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink">{title}</div>
          {subtitle && <div className="text-[11px] text-mute">{subtitle}</div>}
        </div>
        <ChevronRight
          size={14}
          className={cn("shrink-0 text-mute transition-transform", open && "rotate-90")}
        />
      </summary>
      <div className="border-t border-line">
        {children}
      </div>
    </details>
  );
}
