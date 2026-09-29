import { createContext, useContext } from 'react'
import type { ServiceType } from '../content/services'

export interface ContactApi {
  /** Open the contact modal, optionally with one service pre-selected. */
  openContact: (preselect?: ServiceType) => void
}

export const ContactContext = createContext<ContactApi>({ openContact: () => {} })

export function useContact() {
  return useContext(ContactContext)
}
