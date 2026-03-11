/**
 * Nostr metadata types based on NIP-01 and common NIPs.
 */

/**
 * Kind 0 metadata (profile information).
 * Based on NIP-01 specification.
 */
export interface NostrMetadata {
  /** A short description of the user */
  about?: string;
  /** A URL to a wide (~1024x768) picture to be displayed in the background of a profile screen */
  banner?: string;
  /** Boolean to clarify that the content is entirely or partially the result of automation */
  bot?: boolean;
  /** An alternative, bigger name with richer characters than `name` */
  display_name?: string;
  /** A bech32 lightning address according to NIP-57 and LNURL specifications */
  lud06?: string;
  /** An email-like lightning address according to NIP-57 and LNURL specifications */
  lud16?: string;
  /** A short name to be displayed for the user */
  name?: string;
  /** An email-like Nostr address according to NIP-05 */
  nip05?: string;
  /** A URL to the user's avatar */
  picture?: string;
  /** A web URL related in any way to the event author */
  website?: string;
  /** Any other custom fields */
  [key: string]: string | boolean | undefined;
}
