/**
 * Card / Panel — surface containers on two glass tiers.
 *
 * Card  = translucent glass over the void (default content surface).
 * Panel = solid elevated surface for popover/dropdown/menu tiers where
 *         content must not show the layer beneath.
 *
 * Both are polymorphic via `as` so a card can be a <section>, <article>,
 * <li>, etc. without losing the styling.
 */

import { forwardRef } from "react";
import type { ComponentPropsWithoutRef, ElementType, Ref } from "react";

export type CardVariant = "default" | "strong";
export type CardPadding = "none" | "sm" | "md" | "lg";

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type PolymorphicProps<E extends ElementType, P> = P & {
  as?: E;
} & Omit<ComponentPropsWithoutRef<E>, keyof P | "as">;

export type CardProps<E extends ElementType = "div"> = PolymorphicProps<
  E,
  { variant?: CardVariant; padding?: CardPadding }
>;

export const Card = forwardRef(function Card<E extends ElementType = "div">(
  { as, variant = "default", padding = "md", className, ...rest }: CardProps<E>,
  ref: Ref<Element>,
) {
  const Tag = (as ?? "div") as ElementType;
  return (
    <Tag
      ref={ref}
      className={cx(
        "card",
        variant === "strong" && "card-strong",
        `card-pad-${padding}`,
        className,
      )}
      {...rest}
    />
  );
});

export type PanelProps<E extends ElementType = "div"> = PolymorphicProps<
  E,
  { padding?: CardPadding }
>;

export const Panel = forwardRef(function Panel<E extends ElementType = "div">(
  { as, padding = "md", className, ...rest }: PanelProps<E>,
  ref: Ref<Element>,
) {
  const Tag = (as ?? "div") as ElementType;
  return (
    <Tag
      ref={ref}
      className={cx("panel", `card-pad-${padding}`, className)}
      {...rest}
    />
  );
});
