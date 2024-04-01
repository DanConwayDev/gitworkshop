import {
  defaults as user_defaults,
  type User,
} from '$lib/components/users/type'
import { NDKNip07Signer, NDKRelayList } from '@nostr-dev-kit/ndk'
import { get, writable, type Unsubscriber, type Writable } from 'svelte/store'
import { ndk } from './ndk'

export const users: { [hexpubkey: string]: Writable<User> } = {}

export const ensureUser = (hexpubkey: string): Writable<User> => {
  if (!users[hexpubkey]) {
    const u = ndk.getUser({ hexpubkey })

    const base: User = {
      loading: false,
      hexpubkey,
      npub: u.npub,
    }

    users[hexpubkey] = writable(base)
    getUserRelays(hexpubkey)
    u.fetchProfile({
      closeOnEose: true,
      groupable: true,
      // default 100
      groupableDelay: 200,
    }).then(
      (p) => {
        users[hexpubkey].update((u) => ({
          ...u,
          loading: false,
          profile: p === null ? undefined : p,
        }))
      },
      () => {
        users[hexpubkey].update((u) => ({
          ...u,
          loading: false,
        }))
      }
    )
  }
  return users[hexpubkey]
}

export const returnUser = async (hexpubkey: string): Promise<User> => {
  return new Promise((r) => {
    const unsubscriber = ensureUser(hexpubkey).subscribe((u) => {
      if (!u.loading) {
        setTimeout(() => {
          if (unsubscriber) unsubscriber()
        }, 5)
        r(u)
      }
    })
  })
}

// nip07_plugin is set in Navbar component
export const nip07_plugin: Writable<undefined | boolean> = writable(undefined)

export const checkForNip07Plugin = () => {
  if (window.nostr) {
    nip07_plugin.set(true)
  } else {
    let timerId: NodeJS.Timeout | undefined = undefined
    const intervalId = setInterval(() => {
      if (window.nostr) {
        clearTimeout(timerId)
        clearInterval(intervalId)
        nip07_plugin.set(true)
      }
    }, 100)
    timerId = setTimeout(() => {
      clearInterval(intervalId)
      nip07_plugin.set(false)
    }, 5000)
  }
}

const signer = new NDKNip07Signer(2000)

export const logged_in_user: Writable<undefined | User> = writable(undefined)

export const login = async (): Promise<void> => {
  return new Promise(async (res, rej) => {
    const user = get(logged_in_user)
    if (user) return res()
    if (get(nip07_plugin)) {
      try {
        const ndk_user = await signer.blockUntilReady()
        logged_in_user.set({
          ...user_defaults,
          hexpubkey: ndk_user.pubkey,
        })
        ndk.signer = signer
        ensureUser(ndk_user.pubkey).subscribe((user) => {
          logged_in_user.set({ ...user })
        })
        return res()
      } catch (e) {
        alert(e)
        rej()
      }
    } else {
      rej()
    }
  })
}

interface UserRelays {
  loading: boolean
  ndk_relays: NDKRelayList | undefined
}

export const user_relays: { [hexpubkey: string]: Writable<UserRelays> } = {}

export const getUserRelays = async (hexpubkey: string): Promise<UserRelays> => {
  return new Promise(async (res, _) => {
    if (user_relays[hexpubkey]) {
      const unsubscriber: Unsubscriber = user_relays[hexpubkey].subscribe(
        (querying_user_relays) => {
          if (querying_user_relays && !querying_user_relays.loading) {
            res(querying_user_relays)
            setTimeout(() => {
              if (unsubscriber) unsubscriber()
            }, 5)
          }
        }
      )
    } else {
      user_relays[hexpubkey] = writable({
        loading: true,
        ndk_relays: undefined,
      })
      const relay_list = await ndk
        .getUser({ hexpubkey })
        // when batching requests NDK creates a really long subid,
        // beyond the 71 chars that most relays support
        .relayList()
      const querying_user_relays = {
        loading: false,
        ndk_relays: relay_list,
      }
      user_relays[hexpubkey].set({ ...querying_user_relays })
      res(querying_user_relays)
    }
  })
}
