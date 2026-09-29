import type { ServiceType } from '../content/services'

export interface ContactForm {
  name: string
  email: string
  message: string
  types: ServiceType[]
  budget: string
}

export const emptyForm: ContactForm = { name: '', email: '', message: '', types: [], budget: '' }
