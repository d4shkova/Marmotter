/**
 * @marmotter/protocol — pure IRC protocol layer.
 *
 * All IRC protocol logic lives here, in TypeScript, so desktop, web, and Android
 * share one implementation. This package performs no I/O and imports nothing.
 *
 * Phase 1 of BUILD_PLAN.md fills this out: line parser and serializer, CAP
 * negotiation, SASL, ISUPPORT, casemapping, the numeric map, the mode parser,
 * CTCP, batch and labeled-response correlation, and standard replies.
 */

export * from './limits.js';
