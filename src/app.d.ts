// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	// Build-time constants injected by Vite
	const __GIT_COMMIT__: string;
	const __COMMIT_DATE__: string;
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

// PWA Virtual Modules
declare module 'virtual:pwa-register' {
	export interface RegisterSWOptions {
		immediate?: boolean;
		onNeedRefresh?: () => void;
		onOfflineReady?: () => void;
		onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
		onRegisterError?: (error: any) => void;
	}

	export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}

export {};
