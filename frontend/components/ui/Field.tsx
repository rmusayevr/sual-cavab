import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

import { cx } from "@/lib/cx";

/** What a control needs to be tied to its label, hint and error message. */
export type FieldControlProps = { id: string; "aria-describedby"?: string; "aria-invalid"?: true };

const controlClasses =
  "w-full min-h-11 rounded-lg border border-control-border bg-surface px-3 py-2 text-base text-text " +
  "placeholder:text-muted aria-invalid:border-error-fg disabled:opacity-60";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(controlClasses, className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(controlClasses, "min-h-24", className)} {...rest} />;
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(controlClasses, className)} {...rest} />;
}

/**
 * A label, a control, an optional hint and an optional error message, tied
 * together: the label points at the control, and the control points at the
 * hint and the error (aria-describedby) and is marked invalid on an error.
 *
 *   <Field label="Email" error={errors.email}>
 *     {(props) => <Input type="email" {...props} />}
 *   </Field>
 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: (props: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");
  const props: FieldControlProps = { id };
  if (describedBy) props["aria-describedby"] = describedBy;
  if (error) props["aria-invalid"] = true;

  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
      </label>
      {children(props)}
      {hint && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm text-error-fg">
          {error}
        </p>
      )}
    </div>
  );
}
