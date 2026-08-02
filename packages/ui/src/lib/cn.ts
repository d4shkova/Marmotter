/**
 * Class-name joining.
 *
 * Deliberately not `clsx`: the whole need is "drop the falsy ones and join",
 * and a dependency for that in a package this small is not worth the supply
 * chain it brings with it.
 */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ');
}
