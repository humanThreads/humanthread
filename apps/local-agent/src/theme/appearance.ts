export const APPEARANCES = ["light", "hybrid", "dark"] as const;

export type Appearance = (typeof APPEARANCES)[number];

export function normalizeAppearance(value: unknown): Appearance {
  return APPEARANCES.includes(value as Appearance) ? value as Appearance : "light";
}
