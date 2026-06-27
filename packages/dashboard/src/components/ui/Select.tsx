/**
 * Select — native <select> styled to match Input. Native appearance is
 * removed and a token-coloured chevron is drawn via CSS so the control
 * reads as part of the form set while keeping native keyboard / option UX.
 *
 * `size` is visual density (sm/md/lg), not the native list-size attribute
 * (omitted to avoid the name clash).
 */

import { forwardRef } from "react";
import type { SelectHTMLAttributes } from "react";
import { FieldShell, fieldCx, useFieldA11y } from "./Field";
import type { FieldOwnProps } from "./Field";
import type { FieldSize } from "./Input";

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size">,
    FieldOwnProps {
  size?: FieldSize;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    size = "md",
    label,
    hint,
    error,
    hideLabel,
    required,
    id,
    className,
    disabled,
    children,
    ...rest
  },
  ref,
) {
  const a11y = useFieldA11y(id, hint, error);
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      hideLabel={hideLabel}
      required={required}
      a11y={a11y}
    >
      <select
        ref={ref}
        id={a11y.controlId}
        className={fieldCx(
          "field",
          "field-select",
          `field-${size}`,
          error ? "field-error" : undefined,
          className,
        )}
        aria-invalid={a11y.invalid || undefined}
        aria-describedby={a11y.describedBy}
        aria-required={required || undefined}
        required={required}
        disabled={disabled}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
});
