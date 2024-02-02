import type { User } from '../users/type'

export interface Event {
  author: User
  content: unknown
}
