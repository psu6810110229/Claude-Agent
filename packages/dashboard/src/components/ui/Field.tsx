/**
 * Field — shared label / hint / error scaffold for the form primitives
 * (Input, Textarea, Select). Centralises the a11y wiring so every control
 * gets: a real <label htmlFor>, hint + error text linked via
 * aria-describedby, and aria-invalid on error — derived once here instead
 * of re-hand-rolled per surface.
 */

import { useId } from "react";
import type { ReactNode } from "react";

export interface FieldOwnProps {
  /** Visible (or sr-only) label text. */
  label?: ReactNode;
  /** Helper text under the control. */
  hint?: ReactNode;
  /** Error message — when set, marks the control invalid + rose ring. */
  error?: ReactNode;
  /** Keep the label for screen readers but hide it visually. */
  hideLabel?: boolean;
  /** Mark the field required (adds the visual asterisk). */
  required?: boolean;
}

/** Ids + aria props wiring a control to its label/hint/error. */
export interface FieldA11y {
  controlId: string;
  hintId: string;
  errorId: string;
  describedBy?: string;
  invalid: boolean;
}

/** Derive stable ids and the describedby chain for one field instance. */
export function useFieldA11y(
  idProp: string | undefined,
  hint: ReactNode,
  error: ReactNode,
): FieldA11y {
  const auto = useId();
  const controlId = idProp ?? auto;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") ||
    undefined;
  return { controlId, hintId, errorId, describedBy, invalid: Boolean(error) };
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export interface FieldShellProps extends FieldOwnProps {
  a11y: FieldA11y;
  className?: string;
  children: ReactNode;
}

/** Wraps a control with its label (top) and hint/error (bottom). */
export function FieldShell({
  label,
  hint,
  error,
  hideLabel = false,
  required = false,
  a11y,
  className,
  children,
}: FieldShellProps) {
  return (
    <div className={cx("field-wrap", className)}>
      {label != null && (
        <label
          htmlFor={a11y.controlId}
          className={cx("field-label", hideLabel && "sr-only")}
        >
          {label}
          {required && (
            <span className="field-label-req" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {children}
      {error != null ? (
        <span id={a11y.errorId} className="field-error-text" role="alert">
          {error}
        </span>
      ) : (
        hint != null && (
          <span id={a11y.hintId} className="field-hint">
            {hint}
          </span>
        )
      )}
    </div>
  );
}

export { cx as fieldCx };
