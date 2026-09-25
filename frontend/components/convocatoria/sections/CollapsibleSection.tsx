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
      className="overflow-hidden rounded-2xl border border-line bg-paper"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-4 py-2.5 hover:bg-paperSoft [&::-webkit-details-marker]:hidden">
        {icon && <span className="shrink-0 text-mute">{icon}</span>}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink">{title}</div>
          {subtitle && <div className="text-[12px] text-mute">{subtitle}</div>}
        </div>
        <ChevronRight
          size={14}
          aria-hidden
          className={cn("shrink-0 text-mute transition-transform duration-rapido", open && "rotate-90")}
        />
      </summary>
      <div className="border-t border-line">
        {children}
      </div>
    </details>
  );
}
