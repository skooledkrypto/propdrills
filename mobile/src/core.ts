/**
 * Single import point for the shared domain core (../../src/core) — the same
 * tested modules the web app uses, untouched. Metro watches that folder via
 * metro.config.js.
 */
export * from '../../src/core/types';
export * from '../../src/core/config';
export * from '../../src/core/patterns';
export * from '../../src/core/synth';
export * from '../../src/core/sessions';
export * from '../../src/core/levels';
export * from '../../src/core/detect';
export * from '../../src/core/scheduler';
export * from '../../src/core/scoring';
export * from '../../src/core/backup';
export * from '../../src/core/challenge';
export * from '../../src/core/entitlement';
export * from '../../src/core/legal';
export * from '../../src/core/levelDrill';
export * from '../../src/core/sync';
