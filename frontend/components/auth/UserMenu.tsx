"use client";

import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { LogIn, LogOut, User as UserIcon, ChevronDown } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { signOut } from "@/lib/auth";
import { cn } from "@/lib/utils";

export function UserMenu() {
  const { user, userId, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (loading) {
    return (
      <div className="h-9 w-20 animate-pulse rounded-full bg-line/50" />
    );
  }

  if (!user) {
    return (
      <Link
        href="/login"
        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paperSoft px-3.5 py-2 text-sm font-medium text-ink hover:bg-paperDeep"
      >
        <LogIn size={14} />
        Login
      </Link>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border border-line bg-paperSoft px-3 py-1.5 text-sm font-medium text-ink hover:bg-paperDeep",
          open && "bg-paperDeep",
        )}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-clay text-paper">
          <UserIcon size={12} />
        </span>
        <span className="hidden max-w-[120px] truncate sm:inline">
          {userId}
        </span>
        <ChevronDown
          size={13}
          className={cn("text-mute transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-56 origin-top-right animate-slideUp rounded-2xl border border-line bg-paperSoft p-1.5 shadow-paper">
          <div className="border-b border-line px-3 py-2">
            <div className="text-[10px] uppercase tracking-widest text-mute">
              Sesión activa
            </div>
            <div className="truncate font-mono text-sm font-medium text-ink">
              {userId}
            </div>
          </div>
          <button
            onClick={async () => {
              await signOut();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-ink hover:bg-paper"
          >
            <LogOut size={14} className="text-rust" />
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}
