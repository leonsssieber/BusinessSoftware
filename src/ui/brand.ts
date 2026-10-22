import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export interface Brand {
  name: string;
  tagline: string;
  /** Wordmark with icon, used in the sidebar and auth pages. */
  logo: ReactNode;
  /** Reasons to sign up, shown beside the signup form. */
  pitch: string[];
}

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}
