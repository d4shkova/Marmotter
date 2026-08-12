/**
 * Logging: what to keep, for how long, and what it looks like on disk.
 *
 * Every function here is pure. The `LogStore` that actually writes is supplied
 * by the platform — desktop has one, web deliberately has none — so this module
 * can be reasoned about and tested without a disk, and the web build carries
 * the decisions without carrying any way to act on them.
 */

export * from './policy.js';
export * from './plaintext.js';
export * from './records.js';
export * from './search.js';
