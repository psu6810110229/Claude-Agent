/**
 * Button — shared action primitive. Composes the design tokens (control
 * heights, radius, type scale) so every action looks the same and the a11y
 * baseline (44px touch on coarse pointers, visible focus ring) is baked in
 * once here instead of re-derived per surface.
 *
 * Variant = visual weight / intent. Size = density. State = hover / active /
 * focus-visible / disabled / loading (all in CSS via the `.btn` system).
 */

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "link";

export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to fill the parent (block button). */
  fullWidth?: boolean;
  /** Show a spinner, set aria-busy, and block interaction. */
  loading?: boolean;
  /** Icon before the label. */
  iconLeading?: ReactNode;
  /** Icon after the label. */
  iconTrailing?: ReactNode;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    fullWidth = false,
    loading = false,
    iconLeading,
    iconTrailing,
    disabled,
    className,
    children,
    type,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      // Default to type="button" — bare <button> in a form submits otherwise.
      type={type ?? "button"}
      className={cx(
        "btn",
        `btn-${variant}`,
        `btn-${size}`,
        fullWidth && "btn-block",
        loading && "is-loading",
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="btn-spinner" aria-hidden="true" />}
      {iconLeading && (
        <span className="btn-icon" aria-hidden="true">
          {iconLeading}
        </span>
      )}
      {children != null && <span className="btn-label">{children}</span>}
      {iconTrailing && (
        <span className="btn-icon" aria-hidden="true">
          {iconTrailing}
        </span>
      )}
    </button>
  );
});
