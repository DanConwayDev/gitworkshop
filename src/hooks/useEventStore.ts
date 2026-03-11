/**
 * Re-export the useEventStore hook from applesauce-react.
 *
 * This hook returns the global EventStore instance from context.
 * Must be used within an EventStoreProvider.
 *
 * @example
 * ```tsx
 * import { useEventStore } from '@/hooks/useEventStore';
 *
 * function MyComponent() {
 *   const store = useEventStore();
 *
 *   // Query events
 *   const events = store.getEvents({ kinds: [1], limit: 20 });
 *
 *   // Add events
 *   store.add(event);
 *
 *   return <div>...</div>;
 * }
 * ```
 */
export { useEventStore } from "applesauce-react/hooks";
