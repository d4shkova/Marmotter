/**
 * Which build of Marmotter this is.
 *
 * Written into a settings export so somebody holding two of them can tell which
 * came from where — and so a file that will not load can be reported with the
 * build that wrote it rather than a guess. Nothing branches on it: the document
 * is read field by field with every setting falling back to its own default,
 * which is what lets a phone and a desktop on different releases exchange
 * settings at all.
 *
 * Replaced at build time by each app's Vite config, from that app's own
 * `package.json`. The `typeof` guard is what makes it safe everywhere else —
 * a unit test renders these components with no bundler in front of them, and a
 * bare reference to an undeclared global would throw rather than read as
 * "unknown build".
 */

declare const __MARMOTTER_VERSION__: string | undefined;

export const APP_VERSION: string | undefined =
  typeof __MARMOTTER_VERSION__ === 'string' && __MARMOTTER_VERSION__ !== ''
    ? __MARMOTTER_VERSION__
    : undefined;
