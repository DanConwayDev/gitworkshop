import { NDKNip07Signer } from '@nostr-dev-kit/ndk'
import { get, writable, type Unsubscriber, type Writable } from 'svelte/store'
import { ndk } from './ndk'
import { type PubKeyInfo, type PubKeyString } from '$lib/dbs/types'
import relays_manager from './RelaysManager'
import type { Observable } from 'dexie'

export const users: { [hexpubkey: PubKeyString]: Observable<PubKeyInfo> } = {}

export const ensureUser = (hexpubkey: PubKeyString): Observable<PubKeyInfo> => {
  if (!users[hexpubkey]) {
    users[hexpubkey] = relays_manager.fetchPubkeyInfoWithObserable(hexpubkey)
  }
  return users[hexpubkey]
}

// nip07_plugin is set in Navbar component
export const nip07_plugin: Writable<undefined | boolean> = writable(undefined)

export const checkForNip07Plugin = () => {
  if (window.nostr) {
    nip07_plugin.set(true)
    if (localStorage.getItem('nip07pubkey')) login()
  } else {
    let timerId: NodeJS.Timeout | undefined = undefined
    const intervalId = setInterval(() => {
      if (window.nostr) {
        clearTimeout(timerId)
        clearInterval(intervalId)
        nip07_plugin.set(true)
        if (localStorage.getItem('nip07pubkey')) login()
      }
    }, 100)
    timerId = setTimeout(() => {
      clearInterval(intervalId)
      nip07_plugin.set(false)
    }, 5000)
  }
}

const signer = new NDKNip07Signer(2000)

export const logged_in_user: Writable<undefined | PubKeyInfo> =
  writable(undefined)

let login_unsubscriber: Unsubscriber | undefined = undefined

export const login = async (): Promise<void> => {
  logout()
  return new Promise(async (res, rej) => {
    const user = get(logged_in_user)
    if (user) return res()
    if (get(nip07_plugin)) {
      try {
        const ndk_user = await signer.blockUntilReady()
        localStorage.setItem('nip07pubkey', ndk_user.pubkey)
        // ndk.signer = signer
        login_unsubscriber = ensureUser(ndk_user.pubkey).subscribe((user) => {
          logged_in_user.set(user)
        }).unsubscribe
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

export const logout = async (): Promise<void> => {
  if (login_unsubscriber) login_unsubscriber()
  logged_in_user.set(undefined)
  localStorage.removeItem('nip07pubkey')
  ndk.signer = undefined
}
