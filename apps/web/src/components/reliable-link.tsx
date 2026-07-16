"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";

interface ReliableLinkProps {
  href: string;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
  "data-active"?: boolean;
}

const NAVIGATION_FALLBACK_DELAY_MS = 2500;

export function ReliableLink({ href, children, ...props }: ReliableLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const currentUrl = window.location.href;
    const destinationUrl = new URL(href, currentUrl).href;
    if (destinationUrl === currentUrl) {
      return;
    }

    window.setTimeout(() => {
      if (window.location.href === currentUrl) {
        window.location.assign(destinationUrl);
      }
    }, NAVIGATION_FALLBACK_DELAY_MS);
  }

  return (
    <Link href={href} onClick={handleClick} {...props}>
      {children}
    </Link>
  );
}
