/**
 * Layout primitives — Stack / Cluster / Container.
 *
 * Stack     = vertical flow with a token-scale gap (vertical rhythm).
 * Cluster   = horizontal group that wraps, with a token-scale gap.
 * Container = max-width + centered content column (page/section width).
 *
 * Gaps map to the spacing scale (--space-N) via `.stack-N` / `.cluster-N`
 * classes, so spacing stays on the 4px grid instead of inline magic px.
 * All three are polymorphic via `as`.
 */

import { forwardRef } from "react";
import type { ComponentPropsWithoutRef, ElementType, Ref } from "react";

/** Subset of the spacing scale exposed as gap steps. */
export type GapStep = 1 | 2 | 3 | 4 | 5 | 6 | 8;
export type AlignStep = "start" | "center" | "end" | "stretch";
export type JustifyStep = "start" | "center" | "end" | "between";
export type ContainerSize = "sm" | "md" | "lg" | "xl" | "default";

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type PolymorphicProps<E extends ElementType, P> = P & {
  as?: E;
} & Omit<ComponentPropsWithoutRef<E>, keyof P | "as">;

export type StackProps<E extends ElementType = "div"> = PolymorphicProps<
  E,
  { gap?: GapStep; align?: AlignStep }
>;

export const Stack = forwardRef(function Stack<E extends ElementType = "div">(
  { as, gap = 4, align, className, ...rest }: StackProps<E>,
  ref: Ref<Element>,
) {
  const Tag = (as ?? "div") as ElementType;
  return (
    <Tag
      ref={ref}
      className={cx("stack", `stack-${gap}`, align && `stack-align-${align}`, className)}
      {...rest}
    />
  );
});

export type ClusterProps<E extends ElementType = "div"> = PolymorphicProps<
  E,
  { gap?: GapStep; align?: AlignStep; justify?: JustifyStep }
>;

export const Cluster = forwardRef(function Cluster<E extends ElementType = "div">(
  { as, gap = 2, align = "center", justify, className, ...rest }: ClusterProps<E>,
  ref: Ref<Element>,
) {
  const Tag = (as ?? "div") as ElementType;
  return (
    <Tag
      ref={ref}
      className={cx(
        "cluster",
        `cluster-${gap}`,
        `cluster-align-${align}`,
        justify && `cluster-justify-${justify}`,
        className,
      )}
      {...rest}
    />
  );
});

export type ContainerProps<E extends ElementType = "div"> = PolymorphicProps<
  E,
  { size?: ContainerSize }
>;

export const Container = forwardRef(function Container<
  E extends ElementType = "div",
>({ as, size = "default", className, ...rest }: ContainerProps<E>, ref: Ref<Element>) {
  const Tag = (as ?? "div") as ElementType;
  return (
    <Tag
      ref={ref}
      className={cx("container", `container-${size}`, className)}
      {...rest}
    />
  );
});
