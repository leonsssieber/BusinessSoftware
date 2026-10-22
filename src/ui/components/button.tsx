import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Link, type LinkProps } from "react-router";
import { cn } from "../cn";
import { Spinner } from "./display";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra?: string): string {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-ui font-medium whitespace-nowrap transition-colors select-none",
    "disabled:cursor-not-allowed disabled:opacity-55",
    size === "sm" && "h-8 px-3 text-[13px]",
    size === "md" && "h-10 px-4 text-sm",
    size === "lg" && "h-12 px-5 text-base",
    variant === "primary" && "bg-brand text-brand-fg hover:bg-brand/88 shadow-sm",
    variant === "secondary" && "border border-line-strong bg-surface text-fg hover:bg-surface-2",
    variant === "ghost" && "text-fg hover:bg-surface-2",
    variant === "danger" && "bg-bad text-white hover:bg-bad/88",
    extra,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant, size, loading, icon, className, children, disabled, type, ref, ...rest }: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant,
  size,
  icon,
  className,
  children,
  ...rest
}: LinkProps & { variant?: ButtonVariant; size?: ButtonSize; icon?: ReactNode }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
