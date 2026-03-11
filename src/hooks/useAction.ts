/**
 * Re-export the useAction hook from applesauce-react.
 *
 * This hook provides access to pre-built Nostr actions like:
 * - CreateNote, DeleteEvent
 * - FollowUser, UnfollowUser
 * - MuteUser, UnmuteUser
 * - UpdateProfile, UpdateContacts
 * - CreateBookmark, CreatePin
 * - And many more...
 *
 * @example
 * ```tsx
 * import { useAction } from '@/hooks/useAction';
 * import { CreateNote, FollowUser } from 'applesauce-actions/actions';
 *
 * function PostForm() {
 *   const createNote = useAction(CreateNote);
 *   const [content, setContent] = useState('');
 *
 *   const handleSubmit = async () => {
 *     await createNote(content);
 *     setContent('');
 *   };
 *
 *   return (
 *     <form onSubmit={handleSubmit}>
 *       <textarea value={content} onChange={e => setContent(e.target.value)} />
 *       <button type="submit">Post</button>
 *     </form>
 *   );
 * }
 *
 * function FollowButton({ pubkey }: { pubkey: string }) {
 *   const followUser = useAction(FollowUser);
 *
 *   return <button onClick={() => followUser(pubkey)}>Follow</button>;
 * }
 * ```
 */
export { useAction } from "applesauce-react/hooks";
