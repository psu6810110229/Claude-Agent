/**
 * Textarea — multi-line text control. Same Field scaffold + `.field` style
 * as Input; the CSS gives textarea its taller min-height, vertical padding,
 * and vertical-only resize.
 */

import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";
import { FieldShell, fieldCx, useFieldA11y } from "./Field";
import type { FieldOwnProps } from "./Field";

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement>,
    FieldOwnProps {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { label, hint, error, hideLabel, required, id, className, disabled, ...rest },
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
        <textarea
          ref={ref}
          id={a11y.controlId}
          className={fieldCx("field", error ? "field-error" : undefined, className)}
          aria-invalid={a11y.invalid || undefined}
          aria-describedby={a11y.describedBy}
          aria-required={required || undefined}
          required={required}
          disabled={disabled}
          {...rest}
        />
      </FieldShell>
    );
  },
);
