type ClassValue = string | false | null | undefined;

/** Tiny class joiner. Avoids pulling in clsx + tailwind-merge for a handful of call sites. */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}
