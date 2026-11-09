import type { ButtonHTMLAttributes } from "react";

import { cx } from "@/lib/cx";

export type ButtonVariant = "primary" | "secondary" | "danger";

const variants: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-primary text-on-primary hover:opacity-90",
  secondary: "border-control-border bg-surface text-primary hover:bg-bg",
  danger: "border-error-fg bg-error-bg text-error-fg hover:opacity-90",
};

/**
 * The classes of a button, also for a link that should look like one (a link is
 * not a button, so it stays an <a>). At least 44 px tall, so it can be tapped on
 * a phone.
 *
 * Every variant sets the font and a border itself: there is no browser reset
 * (see globals.css), and a button keeps the system font and a 2px outset border
 * unless told otherwise (review of #62). Class names are only joined, not merged:
 * a caller's class that conflicts with a built-in one is decided by the order of
 * the CSS, not of the names.
 */
export function buttonClasses(variant: ButtonVariant = "primary", className?: string): string {
  return cx(
    "inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 font-sans text-sm font-medium transition",
    "disabled:cursor-not-allowed disabled:opacity-60",
    variants[variant],
    className,
  );
}

/** A button. Plain `type="button"` by default, so it never submits a form by accident. */
export function Button({
  variant = "primary",
  type = "button",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={buttonClasses(variant, className)} {...rest} />;
}
