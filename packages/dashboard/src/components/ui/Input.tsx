/**
 * Input — single-line text control. Wraps the native <input> in the shared
 * Field scaffold (label/hint/error + a11y) and the token-driven `.field`
 * style so every text input matches and carries the focus ring + touch
 * minimum baked into the CSS once.
 *
 * `size` is the visual density (sm/md/lg), not the native character-width
 * attribute (that is omitted to avoid the name clash).
 */

import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { FieldShell, fieldCx, useFieldA11y } from "./Field";
import type { FieldOwnProps } from "./Field";

export type FieldSize = "sm" | "md" | "lg";

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size">,
    FieldOwnProps {
  size?: FieldSize;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
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
      <input
        ref={ref}
        id={a11y.controlId}
        className={fieldCx("field", `field-${size}`, error ? "field-error" : undefined, className)}
        aria-invalid={a11y.invalid || undefined}
        aria-describedby={a11y.describedBy}
        aria-required={required || undefined}
        required={required}
        disabled={disabled}
        {...rest}
      />
    </FieldShell>
  );
});
