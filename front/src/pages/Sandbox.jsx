import { SandboxOnly } from '../components/SandboxOnly'

/**
 * Page bac à sable : visible uniquement en mode bac à sable.
 * Ajoutez ici vos expérimentations, nouvelles fonctionnalités, etc.
 * Elles n'apparaîtront jamais en version réelle.
 */
export function Sandbox() {
  return (
    <SandboxOnly
      fallback={
        <div className="flex min-h-[40vh] flex-col items-center justify-center text-center">
          <p className="text-slate-500">Cette zone n'existe qu'en mode bac à sable.</p>
          <p className="mt-2 text-sm text-slate-600">
            Passez en « Bac à sable » dans la barre pour y accéder.
          </p>
        </div>
      }
    >
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Expériences</h1>
          <p className="mt-1 text-slate-400">
            Zone bac à sable — ajoutez ici des fonctionnalités, des blocs, des tests sans impacter la version réelle.
          </p>
        </div>

        <div className="rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 p-8 text-center">
          <p className="text-amber-200/90">
            Éditez <code className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-sm">front/src/pages/Sandbox.jsx</code> pour ajouter du contenu.
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Vous pouvez aussi créer de nouvelles pages, les importer ici ou dans le Layout (dans un <code className="rounded bg-slate-700 px-1 font-mono text-xs">SandboxOnly</code>), et utiliser <code className="rounded bg-slate-700 px-1 font-mono text-xs">isSandboxMode()</code> pour brancher de la logique.
          </p>
        </div>
      </div>
    </SandboxOnly>
  )
}
