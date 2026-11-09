import type { ButtonHTMLAttributes } from "react";

import { cx } from "@/lib/cx";

export type ButtonVariant = "primary" | "secondary" | "danger";

const variants: Record<ButtonVariant, string> = {
  primary: "btn-primary border border-transparent",
  secondary: "btn-ghost text-foreground",
  danger: "btn-danger border border-transparent",
};

/**
 * The classes of a button, also for a link that should look like one (a link is
 * not a button, so it stays an <a>). At least 44 px tall, so it can be tapped on
 * a phone.
 *
 * The look is the example's: `btn-primary` (red, the one action colour), `btn-ghost` (a thin
 * outline in the text colour), `btn-danger` (dropping a question). There is no browser reset
 * (see globals.css), so the font is set here and the filled buttons have a transparent border
 * (a button keeps the browser's 2px outset border otherwise; review of #62). Class names are only joined, not merged: a
 * caller's class that conflicts with a built-in one is decided by the order of the CSS.
 */
export function buttonClasses(variant: ButtonVariant = "primary", className?: string): string {
  return cx(
    "min-h-11 justify-center font-sans",
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
