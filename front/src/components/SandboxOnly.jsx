import { isSandboxMode } from '../contract/storageRegistryApi'

/**
 * Affiche les enfants uniquement en mode bac à sable.
 * Utilisez ce composant pour ajouter des pages, liens, sections ou fonctionnalités
 * qui ne doivent pas apparaître en version réelle.
 */
export function SandboxOnly({ children, fallback = null }) {
  if (!isSandboxMode()) return fallback
  return children
}
