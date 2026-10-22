import { useId, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "../cn";

const control =
  "w-full rounded-ui border border-line-strong bg-surface px-3 text-[15px] text-fg placeholder:text-muted/80 " +
  "transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 disabled:bg-surface-2 disabled:text-muted";

export function Input({ className, ref, ...rest }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} className={cn(control, "h-10", className)} {...rest} />;
}

export function Textarea({ className, ref, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return <textarea ref={ref} className={cn(control, "min-h-24 py-2 leading-relaxed", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, "h-10 pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function Checkbox({
  label,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={rest.id ?? id} className={cn("inline-flex items-center gap-2 text-sm", className)}>
      <input id={rest.id ?? id} type="checkbox" className="size-4 accent-[var(--k-brand)]" {...rest} />
      <span>{label}</span>
    </label>
  );
}

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  /** Receives the generated id to put on the control. */
  children: (id: string) => ReactNode;
}

export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="text-[13px] text-bad" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[13px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
