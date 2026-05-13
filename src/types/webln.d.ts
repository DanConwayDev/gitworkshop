/**
 * WebLN (https://www.webln.guide/) browser-extension lightning provider.
 * Only the methods used by gitworkshop are declared.
 */
interface WebLNProvider {
  enable(): Promise<void>;
  sendPayment(invoice: string): Promise<{ preimage: string }>;
  getInfo(): Promise<{
    node: { alias?: string; pubkey?: string; color?: string };
  }>;
}

declare global {
  interface Window {
    webln?: WebLNProvider;
  }
}

export {};
