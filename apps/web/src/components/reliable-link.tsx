import type { ReactNode } from "react";

interface ReliableLinkProps {
  href: string;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
  "data-active"?: boolean;
}

export function ReliableLink({ href, children, ...props }: ReliableLinkProps) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}
